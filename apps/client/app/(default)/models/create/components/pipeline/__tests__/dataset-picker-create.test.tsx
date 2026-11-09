import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SavedDataset } from '@/store/datasets'
import { DatasetPicker } from '../dataset-picker'

/** MODEL-FLOW-032. The Create dataset entry point on Step 1. */

const h = vi.hoisted(() => ({
  datasets: [] as SavedDataset[],
}))

vi.mock('@/hooks/dataset/use-datasets', () => ({
  useDatasets: () => ({ datasets: h.datasets, loading: false }),
}))

beforeEach(() => {
  h.datasets = []
})

describe('DatasetPicker — Create dataset (MODEL-FLOW-032)', () => {
  it('offers Create dataset and calls back when clicked', async () => {
    const onCreate = vi.fn()
    render(
      <DatasetPicker
        workspaceId="ws-1"
        selectedDataset={null}
        onSelectDataset={vi.fn()}
        onCreateDataset={onCreate}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Create dataset' }),
    )
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('offers it again inside the empty state', async () => {
    const onCreate = vi.fn()
    render(
      <DatasetPicker
        workspaceId="ws-1"
        selectedDataset={null}
        onSelectDataset={vi.fn()}
        onCreateDataset={onCreate}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Create a dataset' }),
    )
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('is disabled until a workspace is picked', () => {
    render(
      <DatasetPicker
        workspaceId=""
        selectedDataset={null}
        onSelectDataset={vi.fn()}
        onCreateDataset={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Create dataset' }),
    ).toBeDisabled()
  })

  it('is absent when no handler is given (edit mode)', () => {
    render(
      <DatasetPicker
        workspaceId="ws-1"
        selectedDataset={null}
        onSelectDataset={vi.fn()}
      />,
    )

    expect(
      screen.queryByRole('button', { name: /create (a )?dataset/i }),
    ).toBeNull()
  })
})

/**
 * Step 1's tag chips list the tags a dataset was built FROM, never the
 * columns its feature engineering added (lag, rolling, delta, formula…).
 */
describe('DatasetPicker — tag chips skip engineered features', () => {
  function dataset(
    id: string,
    tags: string[],
    features: unknown[],
  ): SavedDataset {
    return {
      id,
      name: `Dataset ${id}`,
      description: '',
      tags,
      sourceIds: ['src-1'],
      rowCount: 100,
      missingPct: 0,
      pipelineConfig: { features },
    } as unknown as SavedDataset
  }

  it('shows source tags as chips and no lag / rolling chips', () => {
    h.datasets = [
      dataset(
        'a',
        ['TI-101', 'TI-101__lag1', 'TI-101__roll24_mean'],
        [
          { id: '1', kind: 'lag', tag: 'TI-101', k: 1 },
          { id: '2', kind: 'rolling', tag: 'TI-101', window: 24, agg: 'mean' },
        ],
      ),
      dataset(
        'b',
        ['PI-201', 'PI-201__delta'],
        [{ id: '3', kind: 'delta', tag: 'PI-201' }],
      ),
    ]
    render(
      <DatasetPicker
        workspaceId="ws-1"
        selectedDataset={null}
        onSelectDataset={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'TI-101' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PI-201' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /__lag|__roll|__delta/ }),
    ).not.toBeInTheDocument()
  })
})
