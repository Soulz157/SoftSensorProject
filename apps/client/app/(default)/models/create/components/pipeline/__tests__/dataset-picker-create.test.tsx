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
