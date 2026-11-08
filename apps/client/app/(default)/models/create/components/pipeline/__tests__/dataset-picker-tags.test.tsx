import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SavedDataset } from '@/store/datasets'
import { DatasetPicker } from '../dataset-picker'
import { TAG_CHIP_LIMIT } from '@/lib/tag-chips'

/**
 * Step 1's tag filter row. A workspace can hold hundreds of distinct source
 * tags, which buried the dataset cards; the row now shows the first dozen with
 * a Show more, and never hides a tag that is switched on.
 */
const h = vi.hoisted(() => ({
  datasets: [] as SavedDataset[],
}))

vi.mock('@/hooks/dataset/use-datasets', () => ({
  useDatasets: () => ({ datasets: h.datasets, loading: false }),
}))

const TAGS = Array.from(
  { length: 40 },
  (_, i) => `TAG-${String(i + 1).padStart(2, '0')}`,
)

function dataset(id: string, tags: string[]): SavedDataset {
  return {
    id,
    name: `Dataset ${id}`,
    description: null,
    workspaceId: 'ws-1',
    sourceIds: [],
    tags,
    pipelineConfig: { features: [] },
    fileUrl: null,
    rowCount: 100,
    missingPct: 0,
    currentVersionId: null,
    currentArtifactId: null,
    currentArtifactType: null,
  } as unknown as SavedDataset
}

function renderPicker() {
  return render(
    <DatasetPicker
      workspaceId="ws-1"
      selectedDataset={null}
      onSelectDataset={vi.fn()}
    />,
  )
}

/** The filter chips, by their `aria-pressed` toggle (dataset cards are radios). */
const chips = () =>
  screen
    .getAllByRole('button')
    .filter(b => b.hasAttribute('aria-pressed'))
    .map(b => b.textContent)

beforeEach(() => {
  // Two datasets that between them hold 40 distinct tags.
  h.datasets = [dataset('a', TAGS.slice(0, 20)), dataset('b', TAGS.slice(20))]
})

describe('DatasetPicker — tag filter row', () => {
  it('shows only the first dozen tags, with a Show more that counts the rest', () => {
    renderPicker()
    expect(chips()).toEqual(TAGS.slice(0, TAG_CHIP_LIMIT))
    expect(
      screen.getByRole('button', {
        name: `Show more (${40 - TAG_CHIP_LIMIT})`,
      }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('Show more reveals every tag; Show less folds them back', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('button', { name: /^Show more/ }))
    expect(chips()).toEqual(TAGS)
    const less = screen.getByRole('button', { name: 'Show less' })
    expect(less).toHaveAttribute('aria-expanded', 'true')

    await user.click(less)
    expect(chips()).toEqual(TAGS.slice(0, TAG_CHIP_LIMIT))
  })

  it('draws no Show more when there are only a few tags', () => {
    h.datasets = [dataset('a', ['AA', 'BB']), dataset('b', ['CC'])]
    renderPicker()
    expect(chips()).toEqual(['AA', 'BB', 'CC'])
    expect(
      screen.queryByRole('button', { name: /Show (more|less)/ }),
    ).toBeNull()
  })

  it('keeps a tag that is switched on visible after folding, so its filter stays undoable', async () => {
    const user = userEvent.setup()
    renderPicker()
    await user.click(screen.getByRole('button', { name: /^Show more/ }))
    await user.click(screen.getByRole('button', { name: 'TAG-30' }))
    await user.click(screen.getByRole('button', { name: 'Show less' }))

    expect(chips()).toEqual([...TAGS.slice(0, TAG_CHIP_LIMIT), 'TAG-30'])
    expect(screen.getByRole('button', { name: 'TAG-30' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // One of the hidden tags is on screen now, so the count drops by one.
    expect(
      screen.getByRole('button', {
        name: `Show more (${40 - TAG_CHIP_LIMIT - 1})`,
      }),
    ).toBeInTheDocument()
  })

  it('still filters the dataset cards by a tag chosen after Show more', async () => {
    const user = userEvent.setup()
    renderPicker()
    await user.click(screen.getByRole('button', { name: /^Show more/ }))
    await user.click(screen.getByRole('button', { name: 'TAG-35' }))

    expect(screen.getByText(/Showing 1 of 2 datasets/)).toBeInTheDocument()
    const group = screen.getByRole('radiogroup')
    expect(within(group).getAllByRole('radio')).toHaveLength(1)
    expect(within(group).getByText('Dataset b')).toBeInTheDocument()
  })
})
