'use client'

import { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { applyConstantOverlay } from '@/lib/dataset-fetch'
import type { Cell, Dataset } from '@/lib/preprocessing'
import {
  dwCsvDatasetAtom,
  dwCsvFileNameAtom,
  dwFetchRequiredAtom,
  dwFetchStateAtom,
  dwRawDatasetAtom,
  dwSelectedTagsAtom,
  dwTagConstantsAtom,
} from '@/store/dataset-studio'

export interface UseCsvMaterializeResult {
  /** True when at least one selected source needs a live fetch (non-CSV). */
  fetchRequired: boolean
  /** A CSV has been uploaded and parsed into rows. */
  hasCsvData: boolean
  csvTagCount: number
  csvRowCount: number
  fileName: string
}

/**
 * Narrow the parsed CSV grid to the tags selected in Step 1.
 *
 * Selected tags the file does not carry (manually inserted tags, constants)
 * still get a column, filled Bad — the same shape the PI path produces, where
 * `mergeDataset` backfills holes and `applyConstantOverlay` then promotes the
 * constant tags to Good.
 */
function narrowToSelected(csv: Dataset, tags: string[]): Dataset {
  const rows = csv.rows.map(row => {
    const cells: Record<string, Cell> = {}
    for (const tag of tags) {
      cells[tag] = row.cells[tag] ?? { value: 0, status: 'Bad' }
    }
    return { timestamp: row.timestamp, cells }
  })
  return { tags: [...tags], rows }
}

/**
 * Materialize an uploaded CSV into the wizard's raw dataset, in place of a fetch.
 *
 * A CSV already holds the readings, so Step 2 has nothing to request: this
 * writes `dwRawDatasetAtom` and settles `dwFetchStateAtom` to `done` directly,
 * mirroring how edit mode rebuilds the grid without touching the API. The
 * Step-2 gate (`canAdvance` case 2) then passes on its own — the gate itself
 * needs no CSV special case.
 *
 * Runs only for an all-CSV selection; the moment a PI/SQL/REST source is
 * present, `fetchRequired` is true and the normal fetch flow owns these atoms.
 * The `status !== 'done'` guard keeps it idempotent, and every upstream change
 * that invalidates the grid (tag selection, constants) already routes through
 * `nav.resetFetch()`, which returns the status to `idle` and re-arms this.
 */
export function useCsvMaterialize(): UseCsvMaterializeResult {
  const fetchRequired = useAtomValue(dwFetchRequiredAtom)
  const csvDataset = useAtomValue(dwCsvDatasetAtom)
  const fileName = useAtomValue(dwCsvFileNameAtom)
  const selectedTags = useAtomValue(dwSelectedTagsAtom)
  const tagConstants = useAtomValue(dwTagConstantsAtom)
  const fetchState = useAtomValue(dwFetchStateAtom)
  const setRawDataset = useSetAtom(dwRawDatasetAtom)
  const setFetchState = useSetAtom(dwFetchStateAtom)

  useEffect(() => {
    if (fetchRequired) return
    if (fetchState.status === 'done') return
    if (csvDataset.rows.length === 0 || selectedTags.length === 0) return

    const narrowed = narrowToSelected(csvDataset, selectedTags)
    setRawDataset(applyConstantOverlay(narrowed, tagConstants, selectedTags))
    setFetchState({ status: 'done', progress: 100 })
  }, [
    fetchRequired,
    fetchState.status,
    csvDataset,
    selectedTags,
    tagConstants,
    setRawDataset,
    setFetchState,
  ])

  return {
    fetchRequired,
    hasCsvData: csvDataset.rows.length > 0,
    csvTagCount: csvDataset.tags.length,
    csvRowCount: csvDataset.rows.length,
    fileName,
  }
}
