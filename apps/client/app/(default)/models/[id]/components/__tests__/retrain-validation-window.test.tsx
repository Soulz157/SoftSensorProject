import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AIModel } from '@/types'
import type { RetrainIncumbent } from '@/services/model-retrain'

/**
 * The New-data-only validation window inside the retrain dialog, against a
 * chosen version whose data either reaches past the current version's cut or
 * ends before it.
 *
 * The version is preselected through `resumed` (the Data Studio return
 * path) rather than by driving two Radix Selects, which jsdom cannot open.
 */

const h = vi.hoisted(() => ({
  metadata: {
    startTime: '2025-01-01 00:00:00',
    endTime: '2026-03-31 23:00:00',
  },
}))

vi.mock('@/hooks/dataset/use-datasets', () => ({
  useDatasets: () => ({
    datasets: [{ id: 'ds-new', name: 'Reactor tags — new data', tags: [] }],
    loading: false,
    refetch: vi.fn(),
    createDataset: vi.fn(),
    deleteDataset: vi.fn(),
    updateDataset: vi.fn(),
  }),
}))

vi.mock('@/services/dataset-version', () => ({
  datasetVersionService: {
    list: () =>
      Promise.resolve({
        data: [
          {
            id: 'dv-new',
            datasetId: 'ds-new',
            semanticVersion: '1.0.0',
            artifactId: 'art-new',
            versionNumber: 1,
            rowCount: 1000,
          },
        ],
      }),
  },
}))

vi.mock('@/hooks/dataset/artifact/use-dataset-artifact-metadata', () => ({
  useArtifactMetadata: () => ({
    metadata: h.metadata,
    loading: false,
    error: null,
  }),
}))

vi.mock('@/services/tuning-grid', () => ({
  tuningGridService: {
    get: (algorithm: string) =>
      Promise.resolve({ algorithm, variants: [], maxVariantsPerJob: 4 }),
  },
}))

vi.mock('../retrain-monitoring-context', () => ({
  RetrainMonitoringContext: () => <div />,
}))

vi.mock('../retrain-version-eda', () => ({
  RetrainVersionEda: () => <div />,
}))

import { ModelRetrainDialog } from '../model-retrain-dialog'

const MODEL = {
  id: 'model-1',
  name: 'Reactor Temp',
  workspaceId: 'ws-1',
} as AIModel

const INCUMBENT: RetrainIncumbent = {
  versionId: 'version-1',
  version: 3,
  algorithm: 'ridge',
  baseDataset: {
    datasetId: 'ds-base',
    datasetName: 'Reactor tags',
    versionId: 'dv-base',
    versionNumber: 3,
  },
  cutTimestamp: '2025-11-06 00:00:00',
  hyperparameters: null,
  trainTestSplit: null,
}

function renderDialog(
  onStart: (...args: unknown[]) => void = vi.fn(),
  incumbent = INCUMBENT,
) {
  return render(
    <ModelRetrainDialog
      open
      onClose={() => {}}
      model={MODEL}
      incumbent={incumbent}
      loading={false}
      isRetraining={false}
      error={null}
      resumed={{
        strategy: 'NEW_DATA_ONLY',
        datasetId: 'ds-new',
        versionId: 'dv-new',
      }}
      onStart={onStart}
    />,
  )
}

describe('ModelRetrainDialog — New data only validation window', () => {
  it('shows the real data range, the pickable range, and asks for a window', async () => {
    h.metadata = {
      startTime: '2025-01-01 00:00:00',
      endTime: '2026-03-31 23:00:00',
    }
    renderDialog()

    // The REAL range, not the one clamped to the cut.
    expect(
      await screen.findByText(
        /Data covers 2025-01-01 00:00 to 2026-03-31 23:00\. Pickable: 2025-11-06 00:00 to 2026-03-31 23:00\./,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Validation window start' }),
    ).toBeEnabled()
    expect(
      screen.getAllByText('Set the validation window above to start a retrain.')
        .length,
    ).toBeGreaterThan(0)
    expect(
      screen.getByRole('button', { name: /Start Auto Finetune/i }),
    ).toBeDisabled()
  })

  it('pages back before the cut, greys those days, and starts with the picked window', async () => {
    h.metadata = {
      startTime: '2025-01-01 00:00:00',
      endTime: '2026-03-31 23:00:00',
    }
    const user = userEvent.setup()
    const onStart = vi.fn()
    renderDialog(onStart)

    await user.click(
      await screen.findByRole('button', { name: 'Validation window start' }),
    )
    const grid = await screen.findByRole('grid')
    const picker = grid.closest('[data-slot="calendar"]') ?? document.body

    // Navigation spans the whole of the data: 2025 and its early months are
    // offered even though every day before the cut is unpickable. The old
    // native input hid them outright.
    const year = within(picker as HTMLElement).getByRole('combobox', {
      name: /year/i,
    })
    expect(within(year).getByRole('option', { name: '2025' })).toBeEnabled()

    // Opens on the cut's month. The day before the cut is greyed, the cut
    // itself is pickable.
    expect(
      screen.getByRole('button', { name: /November 5th, 2025/ }),
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /November 6th, 2025/ }))
    expect(
      screen.getByRole('button', { name: 'Validation window start' }),
    ).toHaveTextContent('2025-11-06 00:00')

    await user.click(
      screen.getByRole('button', { name: 'Validation window end' }),
    )
    await user.click(
      await screen.findByRole('button', { name: /November 20th, 2025/ }),
    )

    const start = screen.getByRole('button', { name: /Start Auto Finetune/i })
    expect(start).toBeEnabled()
    await user.click(start)
    expect(onStart).toHaveBeenCalledWith(undefined, {
      strategy: 'NEW_DATA_ONLY',
      additionalDatasetVersionId: 'dv-new',
      newValidationFrom: '2025-11-06T00:00:00.000Z',
      newValidationTo: '2025-11-20T23:59:00.000Z',
    })
  })

  // The reported refusal: data 2025-11-17 14:00 -> 2025-11-18 13:00, and a
  // window picked as those two days went out as 00:00 -> 23:59:59.999, which
  // python rejected as outside the dataset. Picking the same two days now
  // lands on the first and last reading; the time can then be narrowed.
  it('clamps a picked day to the first and last reading, and sends the adjusted time', async () => {
    h.metadata = {
      startTime: '2025-11-17 14:00:00',
      endTime: '2025-11-18 13:00:00',
    }
    const user = userEvent.setup()
    const onStart = vi.fn()
    renderDialog(onStart)

    const startTrigger = await screen.findByRole('button', {
      name: 'Validation window start',
    })
    await user.click(startTrigger)
    await user.click(
      await screen.findByRole('button', { name: /November 17th, 2025/ }),
    )
    expect(startTrigger).toHaveTextContent('2025-11-17 14:00')

    const endTrigger = screen.getByRole('button', {
      name: 'Validation window end',
    })
    await user.click(endTrigger)
    await user.click(
      await screen.findByRole('button', { name: /November 18th, 2025/ }),
    )
    expect(endTrigger).toHaveTextContent('2025-11-18 13:00')

    // Narrow the end with the time input.
    const endTime = screen.getByLabelText('Validation window end time')
    // One change with the full value, as a browser time input fires it.
    fireEvent.change(endTime, { target: { value: '09:30' } })
    expect(endTrigger).toHaveTextContent('2025-11-18 09:30')

    await user.click(
      screen.getByRole('button', { name: /Start Auto Finetune/i }),
    )
    expect(onStart).toHaveBeenCalledWith(undefined, {
      strategy: 'NEW_DATA_ONLY',
      additionalDatasetVersionId: 'dv-new',
      newValidationFrom: '2025-11-17T14:00:00.000Z',
      newValidationTo: '2025-11-18T09:30:00.000Z',
    })
  })

  it('says so when the version ends before the cut, instead of asking for a window', async () => {
    h.metadata = {
      startTime: '2025-01-01 00:00:00',
      endTime: '2025-10-31 23:00:00',
    }
    renderDialog()

    expect(
      await screen.findByText(
        /This version has no data on or after 2025-11-06 00:00/,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Validation window start' }),
    ).toBeDisabled()
    expect(
      screen.queryByText('Set the validation window above to start a retrain.'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        'Choose a dataset and version above to start a retrain.',
      ),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Start Auto Finetune/i }),
    ).toBeDisabled()
  })
})

describe('ModelRetrainDialog — Custom Finetune split and hyperparameters', () => {
  it('sends the edited table and the picked split with the retrain', async () => {
    h.metadata = {
      startTime: '2025-01-01 00:00:00',
      endTime: '2026-03-31 23:00:00',
    }
    const user = userEvent.setup()
    const onStart = vi.fn()
    renderDialog(onStart, {
      ...INCUMBENT,
      hyperparameters: { alpha: 3 },
      trainTestSplit: 0.8,
    })

    // The window New data only requires, picked the same way as above.
    await user.click(
      await screen.findByRole('button', { name: 'Validation window start' }),
    )
    await user.click(
      await screen.findByRole('button', { name: /November 6th, 2025/ }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Validation window end' }),
    )
    await user.click(
      await screen.findByRole('button', { name: /November 20th, 2025/ }),
    )
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('tab', { name: /Custom Finetune/i }))

    // Opens on the current version's own ratio and hyperparameters.
    expect(
      await screen.findByText(/Train 80% · Test 20%/),
    ).toBeInTheDocument()
    const alpha = await screen.findByLabelText('Alpha (regularization)')
    expect(alpha).toHaveValue(3)

    await user.click(screen.getByRole('radio', { name: '70:30' }))
    fireEvent.change(alpha, { target: { value: '5' } })

    await user.click(
      screen.getByRole('button', { name: /Start Custom Finetune/i }),
    )
    expect(onStart).toHaveBeenCalledTimes(1)
    const [candidates, options] = onStart.mock.calls[0] as [
      Array<{ algorithm: string; hyperparameters: Record<string, unknown> }>,
      Record<string, unknown>,
    ]
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.algorithm).toBe('ridge')
    expect(candidates[0]?.hyperparameters.alpha).toBe(5)
    expect(options).toMatchObject({
      strategy: 'NEW_DATA_ONLY',
      additionalDatasetVersionId: 'dv-new',
      trainTestSplit: 0.7,
    })
  })

  it('Auto Finetune never sends a split — the current version’s is reused', async () => {
    h.metadata = {
      startTime: '2025-01-01 00:00:00',
      endTime: '2026-03-31 23:00:00',
    }
    const user = userEvent.setup()
    const onStart = vi.fn()
    renderDialog(onStart)

    await user.click(
      await screen.findByRole('button', { name: 'Validation window start' }),
    )
    await user.click(
      await screen.findByRole('button', { name: /November 6th, 2025/ }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Validation window end' }),
    )
    await user.click(
      await screen.findByRole('button', { name: /November 20th, 2025/ }),
    )
    await user.keyboard('{Escape}')
    await user.click(
      screen.getByRole('button', { name: /Start Auto Finetune/i }),
    )

    const [, options] = onStart.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ]
    expect(options).not.toHaveProperty('trainTestSplit')
  })
})
