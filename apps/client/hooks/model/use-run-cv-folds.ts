'use client'

import { useEffect, useState } from 'react'
import { modelDraftRunService, type RunCvFolds } from '@/services/model-draft'

export interface UseRunCvFoldsResult {
  /** Keyed by runId. A run absent from the map has not resolved yet; a run
   *  present with `null` was read and `cv_folds.json` could not be — the
   *  backend soft-reads it (`ModelTrainingRun.cvFolds`), so null means "not
   *  available", never "zero folds". */
  byRunId: Map<string, RunCvFolds | null>
  loading: boolean
}

const NO_RUNS: Map<string, RunCvFolds | null> = new Map()

/**
 * MODEL-FLOW-028-T04. The per-fold plan and metrics for each CV run.
 *
 * Needed because the run LIST endpoint carries only `cvFoldsKey` — the fold
 * cuts and per-fold r2/rmse/mae live in `cv_folds.json`, which only the
 * single-run GET reads. One request per run id, not a batch: Step 3 compares a
 * handful of runs and no batch route for this exists.
 *
 * `loading` and the empty case are DERIVED from which id set the stored result
 * was fetched for, so no state is set synchronously inside the effect.
 */
export function useRunCvFolds(
  draftId: string | null,
  runIds: string[],
): UseRunCvFoldsResult {
  // Keyed on the ids' CONTENT so a caller that rebuilds the array each render
  // does not refetch on every render.
  const idsKey = runIds.join(',')
  const wanted = draftId && idsKey ? `${draftId}|${idsKey}` : null
  const [fetched, setFetched] = useState<{
    key: string
    byRunId: Map<string, RunCvFolds | null>
  } | null>(null)

  useEffect(() => {
    if (!draftId || !wanted) return

    let ignore = false
    void (async () => {
      const entries = await Promise.all(
        idsKey
          .split(',')
          .map(async (id): Promise<[string, RunCvFolds | null]> => {
            try {
              const res = await modelDraftRunService.get(draftId, id)
              return [id, res.data.cvFolds ?? null]
            } catch {
              return [id, null]
            }
          }),
      )
      if (!ignore) setFetched({ key: wanted, byRunId: new Map(entries) })
    })()

    return () => {
      ignore = true
    }
  }, [draftId, idsKey, wanted])

  if (!wanted) return { byRunId: NO_RUNS, loading: false }
  if (fetched?.key !== wanted) return { byRunId: NO_RUNS, loading: true }
  return { byRunId: fetched.byRunId, loading: false }
}
