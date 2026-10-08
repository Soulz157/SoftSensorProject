'use client'

import { useEffect, useState } from 'react'
import { datasetService } from '@/services/dataset'
import type { SavedDataset } from '@/store/datasets'

/**
 * MODEL-SERVE-017. Resolves the model's base dataset so the retrain dialog can
 * show what a new range will be built from, and hand it to the Data Studio
 * wizard.
 *
 * It does NOT fetch rows. An earlier version did, as a preview, and the rows
 * were thrown away — the wizard then fetched the same window again, which the
 * operator paid for twice. Handing the preview's rows to the wizard instead
 * would have been worse: the wizard's own fetch is what fires
 * `useDatasetBronzeWarm`'s materialize, and that is what creates the draft and
 * BRONZE artifact the rest of the pipeline reads. The fetch belongs there,
 * once. See `retrain-fetch-new-data.tsx` for the full note.
 */

export interface UseRetrainBaseDataset {
  baseDataset: SavedDataset | null
  /**
   * The Step-1 SOURCE tag list, which is what the wizard will ask the source
   * for. The saved `tags` are post feature-engineering and column selection,
   * so they can name engineered columns no source has. Legacy recipes saved
   * before `baseTags` existed fall back to `tags` — the same fallback
   * `useDatasetEditNavigation` makes, and it warns for the same reason.
   */
  baseTags: string[]
  loadingBase: boolean
}

/**
 * Validates a picked window before it costs a wizard trip. `fromLocal` and
 * `toLocal` are `datetime-local` strings as the pickers emit them
 * ("YYYY-MM-DDTHH:MM"). Returns the message to show, or null when the window
 * is usable.
 */
export function rangeError(
  fromLocal: string,
  toLocal: string,
  cutTimestamp: string | null,
): string | null {
  if (!fromLocal || !toLocal) return 'Pick both a start and an end.'
  const from = new Date(fromLocal).getTime()
  const to = new Date(toLocal).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return 'That is not a valid date range.'
  }
  if (to <= from) return 'The end must be after the start.'
  // The server's own rule (`assertCompatible`): new data must begin strictly
  // after the incumbent's split boundary, because rows at or before it are
  // the frozen evaluation set it will be scored on. Checked here so an
  // impossible window is refused before the operator builds a whole dataset
  // around it, rather than at retrain time.
  if (cutTimestamp) {
    const cut = new Date(cutTimestamp).getTime()
    if (Number.isFinite(cut) && from <= cut) {
      return (
        'New data must start after the current version’s split boundary ' +
        `(${cutTimestamp}) — earlier rows are the test set it is scored on.`
      )
    }
  }
  return null
}

export function useRetrainBaseDataset(
  baseDatasetId: string | null,
): UseRetrainBaseDataset {
  const [baseDataset, setBaseDataset] = useState<SavedDataset | null>(null)
  const [loadingBase, setLoadingBase] = useState(false)

  useEffect(() => {
    if (!baseDatasetId) {
      setBaseDataset(null)
      return
    }
    let cancelled = false
    setLoadingBase(true)
    void datasetService
      .get(baseDatasetId)
      .then(res => {
        if (!cancelled) setBaseDataset(res.data ?? null)
      })
      .catch(() => {
        if (!cancelled) setBaseDataset(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingBase(false)
      })
    return () => {
      cancelled = true
    }
  }, [baseDatasetId])

  const baseTags =
    baseDataset?.pipelineConfig?.baseTags ?? baseDataset?.tags ?? []

  return { baseDataset, baseTags, loadingBase }
}
