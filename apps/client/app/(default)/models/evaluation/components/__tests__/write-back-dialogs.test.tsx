import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  WriteBackConfigView,
  WriteBackDryRun,
} from '@/services/model-evaluation'
import { WriteBackConfirmDialog } from '../write-back-confirm-dialog'
import { WriteBackConfigDialog } from '../write-back-config-dialog'

const metadata = vi.fn()
vi.mock('@/services/data-sources', () => ({
  dataSourceService: { metadata: (...a: unknown[]) => metadata(...a) },
}))

const dry = (over: Partial<WriteBackDryRun> = {}): WriteBackDryRun => ({
  dryRun: true,
  kind: 'PREDICTION',
  tag: 'OUT.PRED',
  sourceName: 'Plant PI',
  piAccount: 'svc-softsensor',
  pointCount: 120,
  overwriteCount: 7,
  newCount: 113,
  busy: false,
  ...over,
})

describe('WriteBackConfirmDialog', () => {
  const setup = (d: WriteBackDryRun | null, writing = false) => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <WriteBackConfirmDialog
        dryRun={d}
        writing={writing}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    return { onConfirm, onCancel }
  }

  it('renders nothing without a dry run', () => {
    setup(null)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('states the tag, the counts, the PI account, and that it can be rolled back', () => {
    setup(dry())
    expect(screen.getByText('Write predictions to PI?')).toBeInTheDocument()
    expect(screen.getByText('OUT.PRED')).toBeInTheDocument()
    expect(screen.getByText(/120 points will be written/)).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(
      screen.getByText(/replace a value PI already holds/),
    ).toBeInTheDocument()
    expect(screen.getByText('113')).toBeInTheDocument()
    expect(screen.getByText('svc-softsensor')).toBeInTheDocument()
    expect(screen.getByText(/rolled back from the history/)).toBeInTheDocument()
  })

  it('names the lab kind', () => {
    setup(dry({ kind: 'LAB', tag: 'OUT.LAB', pointCount: 1 }))
    expect(screen.getByText('Write lab values to PI?')).toBeInTheDocument()
    expect(screen.getByText(/1 point will be written/)).toBeInTheDocument()
  })

  it('confirm and cancel call their handlers', async () => {
    const { onConfirm, onCancel } = setup(dry())
    await userEvent.click(screen.getByRole('button', { name: 'Write to PI' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('when another write holds the tag: says so and cannot be confirmed', () => {
    setup(dry({ busy: true }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Another write to OUT\.PRED is in progress/,
    )
    expect(screen.getByRole('button', { name: 'Write to PI' })).toBeDisabled()
  })

  it('while writing: confirm and cancel are both disabled', () => {
    setup(dry(), true)
    expect(screen.getByRole('button', { name: /Writing/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})

describe('WriteBackConfigDialog', () => {
  const view = (
    over: Partial<WriteBackConfigView> = {},
  ): WriteBackConfigView => ({
    config: {
      sourceId: 's1',
      predictionTag: 'OUT.PRED',
      labTag: null,
      updatedAt: '2026-10-14T00:00:00.000Z',
    },
    canWrite: true,
    source: {
      id: 's1',
      name: 'Plant PI',
      type: 'aveva',
      piAccount: 'svc',
      writable: true,
    },
    sourceChanged: false,
    targetTag: 'LAB.Y',
    ...over,
  })

  beforeEach(() => {
    metadata.mockReset()
    metadata.mockResolvedValue({ data: { total: 0, tags: [], hasNext: false } })
  })

  type Save = (tags: {
    predictionTag: string | null
    labTag: string | null
  }) => Promise<void>
  const setup = (
    over: { onSave?: Mock<Save>; view?: WriteBackConfigView } = {},
  ) => {
    const onSave = over.onSave ?? vi.fn<Save>().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    render(
      <WriteBackConfigDialog
        open
        onOpenChange={onOpenChange}
        view={over.view ?? view()}
        onSave={onSave}
      />,
    )
    return { onSave, onOpenChange }
  }

  it('starts from the saved tags and names the lab target it must not use', () => {
    setup()
    expect(screen.getByLabelText('Prediction output tag')).toHaveValue(
      'OUT.PRED',
    )
    expect(screen.getByLabelText(/Lab output tag/)).toHaveValue('')
    expect(screen.getByText('LAB.Y')).toBeInTheDocument()
  })

  it('saves trimmed tags, a blank slot as null, then closes', async () => {
    const { onSave, onOpenChange } = setup()
    const pred = screen.getByLabelText('Prediction output tag')
    await userEvent.clear(pred)
    await userEvent.type(pred, '  NEW.PRED  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({
      predictionTag: 'NEW.PRED',
      labTag: null,
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows the server's sentence when it refuses, and stays open", async () => {
    const onSave = vi
      .fn<Save>()
      .mockRejectedValue(new Error('Tag "X" was not found in PI.'))
    const { onOpenChange } = setup({ onSave })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tag "X" was not found in PI.',
    )
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("suggests NUMERIC PI points only, from the model's own source", async () => {
    metadata.mockResolvedValue({
      data: {
        total: 3,
        hasNext: false,
        tags: [
          {
            tag_name: 'OUT.FLOAT',
            point_type: 'Float32',
            unit: 'C',
            description: null,
            value: null,
            isGood: null,
            questionable: null,
            substituted: null,
            timestamp: null,
          },
          {
            tag_name: 'OUT.STATE',
            point_type: 'Digital',
            unit: null,
            description: null,
            value: null,
            isGood: null,
            questionable: null,
            substituted: null,
            timestamp: null,
          },
          {
            tag_name: 'OUT.INT',
            point_type: 'Int32',
            unit: null,
            description: null,
            value: null,
            isGood: null,
            questionable: null,
            substituted: null,
            timestamp: null,
          },
        ],
      },
    })
    setup()
    const lab = screen.getByLabelText(/Lab output tag/)
    await userEvent.click(lab)
    await userEvent.type(lab, 'OUT')
    expect(await screen.findByText('OUT.FLOAT')).toBeInTheDocument()
    expect(screen.getByText('OUT.INT')).toBeInTheDocument()
    expect(screen.queryByText('OUT.STATE')).not.toBeInTheDocument()
    expect(metadata).toHaveBeenCalledWith('s1', {
      nameFilter: '*OUT*',
      page: 1,
      pageSize: 40,
    })

    await userEvent.click(screen.getByText('OUT.FLOAT'))
    expect(lab).toHaveValue('OUT.FLOAT')
  })

  it('does not search for a single character', async () => {
    setup()
    const lab = screen.getByLabelText(/Lab output tag/)
    await userEvent.click(lab)
    await userEvent.type(lab, 'O')
    expect(metadata).not.toHaveBeenCalled()
  })
})
