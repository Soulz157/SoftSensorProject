import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import type { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'
import type { DatasetTagRow } from '@/hooks/dataset/use-dataset-tag-table'
import {
  dwCriticalTagsAtom,
  dwSelectedTagKeysAtom,
  dwTargetTagAtom,
} from '@/store/dataset-studio'

/**
 * Step 1's critical-tag star (lib/critical-tags.ts): it keeps the list honest
 * through the same side effects the target button already has.
 */

const h = vi.hoisted(() => ({
  rows: [] as DatasetTagRow[],
  renameRow: vi.fn(),
  deleteRow: vi.fn(),
}))

vi.mock('@/hooks/dataset/use-dataset-tag-search', () => ({
  MAX_NAMES: 50,
  useDatasetTagSearch: () => ({
    mode: 'wildcard',
    metaByTag: new Map(),
    tagsBySource: {},
    notFound: [],
    droppedNames: [],
    truncatedPatterns: [],
    emptyPatterns: [],
    droppedPatterns: [],
    hasNextBySource: {},
    pageBySource: {},
    goto: vi.fn(),
    refetch: vi.fn(),
    loading: false,
    error: null,
  }),
}))

vi.mock('@/hooks/dataset/use-dataset-tag-table', () => ({
  useDatasetTagTable: () => ({
    rows: h.rows,
    deleteRow: h.deleteRow,
    renameRow: h.renameRow,
    addRow: vi.fn(() => 'new'),
    uploadCompare: vi.fn(),
    isConstantEditable: () => false,
    getConstant: () => undefined,
    setConstant: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-sdta-preset', () => ({
  useStageSdtaPreset: () => vi.fn(),
}))
vi.mock('../source-configs/source-picker-sheet', () => ({
  SourcePickerSheet: () => null,
}))
vi.mock('../preset-apply-modal', () => ({ PresetApplyManager: () => null }))

import { UnifiedTagTable } from '../unified-tag-table'

const row = (name: string): DatasetTagRow => ({
  id: name,
  tagName: name,
  originalName: name,
  dataSource: 'Manual',
  status: 'good',
  sourceId: null,
})

const nav = {
  featureConfigs: [],
  selectedTags: [],
  setSelectedTags: vi.fn(),
  selectedColumns: null,
  setSelectedColumns: vi.fn(),
  setFeatureConfigs: vi.fn(),
  setHasInvalidTags: vi.fn(),
} as unknown as UseDatasetPipelineNavResult

function renderTable(store = createStore()) {
  render(
    <Provider store={store}>
      <UnifiedTagTable nav={nav} />
    </Provider>,
  )
  return store
}

const star = (name: string) =>
  screen.getByRole('button', {
    name: new RegExp(`^(Mark|Unmark) ${name} as critical$`),
  })

beforeEach(() => {
  h.rows = [row('FI-1'), row('TI-2')]
  h.renameRow.mockReset()
  h.deleteRow.mockReset()
})

describe('UnifiedTagTable — critical tag star', () => {
  it('marks and unmarks a tag, and marking also selects it', async () => {
    const store = renderTable()
    await userEvent.click(star('FI-1'))
    expect(store.get(dwCriticalTagsAtom)).toEqual(['FI-1'])
    expect(star('FI-1')).toHaveAttribute('aria-pressed', 'true')
    expect(store.get(dwSelectedTagKeysAtom).size).toBe(1)

    await userEvent.click(star('FI-1'))
    expect(store.get(dwCriticalTagsAtom)).toEqual([])
  })

  it('the target cannot be critical, and becoming the target drops the star', async () => {
    const store = createStore()
    store.set(dwCriticalTagsAtom, ['FI-1'])
    renderTable(store)

    await userEvent.click(
      screen.getByRole('button', { name: 'Set FI-1 as target' }),
    )
    expect(store.get(dwTargetTagAtom)).toBe('FI-1')
    expect(store.get(dwCriticalTagsAtom)).toEqual([])
    expect(star('FI-1')).toBeDisabled()
    expect(star('FI-1')).toHaveAttribute(
      'title',
      expect.stringMatching(/target \(Y\) cannot be critical/),
    )
  })

  it('follows a rename', async () => {
    const store = createStore()
    store.set(dwCriticalTagsAtom, ['FI-1'])
    renderTable(store)

    const r = screen.getByText('FI-1').closest('tr')!
    await userEvent.click(within(r).getByTitle('Rename tag'))
    const box = screen.getByDisplayValue('FI-1')
    await userEvent.clear(box)
    await userEvent.type(box, 'FI-1A{Enter}')

    expect(h.renameRow).toHaveBeenCalled()
    expect(store.get(dwCriticalTagsAtom)).toEqual(['FI-1A'])
  })

  it('drops a deleted tag from the list', async () => {
    const store = createStore()
    store.set(dwCriticalTagsAtom, ['FI-1', 'TI-2'])
    renderTable(store)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select FI-1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete' }),
    )

    expect(h.deleteRow).toHaveBeenCalledTimes(1)
    expect(store.get(dwCriticalTagsAtom)).toEqual(['TI-2'])
  })
})
