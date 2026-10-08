'use client'

/**
 * MODEL-FLOW-019-T31. The feature-count sweep's data side: launch the ladder,
 * then read its rows back.
 *
 * WHY THE SEQUENCING LIVES HERE AND NOT IN A CANDIDATE JOB. The candidate-job
 * machine already runs N runs in order, CAS-safe, with reconcile-on-read, and
 * it is the obvious reuse — but it fails two of this task's own acceptance
 * criteria without reversing decisions recorded as deliberate:
 *
 *  - AC67 (every row carries an interval). `runDtoFor` never sets `nSplits`,
 *    and model-draft.authorized.service.ts records "a CV run can never belong
 *    to a sweep" as intent. No CV means no `cv_rmse_std`, so no row would
 *    carry a spread — and a table of seven bare means is the argmin this
 *    feature exists to refuse.
 *  - AC68 (observations per feature). `splitStats` is null BY DESIGN for a
 *    candidate-job run (schema.prisma, MODEL-FLOW-014-T06), so every row's
 *    obs/feature would read "not recorded".
 *
 * Standalone CV runs satisfy both natively and reverse nothing. The cost is
 * that a partially-complete sweep becomes a first-class state — which V42
 * already requires the table to handle, since a row with no interval must
 * make no ordering claim.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  modelDraftRunService,
  type CreateDraftRunInput,
  type ModelTrainingRunListItem,
} from '@/services/model-draft'
import type { SweepPlanRow } from '@/lib/feature-count-sweep'

export interface UseFeatureCountSweepResult {
  runs: ModelTrainingRunListItem[]
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Every run belonging to one sweep, in whatever order the list endpoint
 * returns — the table sorts by the feature count each run RECORDED, never by
 * launch order.
 *
 * Polls while any row is still non-terminal, for the same reason Step 5's own
 * evaluation hook polls: the rows arrive one at a time, and a curve that
 * never filled in would read as a finished curve with holes.
 */
export function useFeatureCountSweep(
  draftId: string | null,
  sweepId: string | null,
): UseFeatureCountSweepResult {
  const [runs, setRuns] = useState<ModelTrainingRunListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const refetch = useCallback(() => setReloadKey(k => k + 1), [])

  // Whether this hook has anything to fetch. The "nothing to fetch" case is
  // DERIVED at the return below rather than written into state by the effect
  // — clearing state inside an effect is both an extra render and the pattern
  // `react-hooks/set-state-in-effect` refuses.
  const enabled = Boolean(draftId && sweepId)

  useEffect(() => {
    if (!enabled) return

    let ignore = false

    const load = async () => {
      setLoading(true)
      try {
        const res = await modelDraftRunService.list(draftId as string)
        if (ignore) return
        setRuns((res.data ?? []).filter(r => r.sweepId === sweepId))
        setError(null)
      } catch (e) {
        if (ignore) return
        // Soft-fail to an empty ladder, never a thrown page: the sweep table
        // is one panel beneath the run's own evaluation, not its subject.
        setRuns([])
        setError(e instanceof Error ? e.message : 'Failed to load the sweep')
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    void load()
    return () => {
      ignore = true
    }
  }, [draftId, sweepId, reloadKey, enabled])

  // One poll while rows are outstanding, cleared as soon as every row is
  // terminal, so a finished sweep costs nothing.
  useEffect(() => {
    const pending = runs.some(
      r => r.status !== 'SUCCEEDED' && r.status !== 'FAILED',
    )
    if (!pending || !enabled) return
    const timer = setTimeout(refetch, 2500)
    return () => clearTimeout(timer)
  }, [runs, enabled, refetch])

  return {
    runs: enabled ? runs : [],
    loading: enabled ? loading : false,
    error: enabled ? error : null,
    refetch,
  }
}

/**
 * Launch one ladder: one CV run per planned row, all sharing `sweepId`.
 *
 * SEQUENTIAL, not parallel. Each row is its own container spawn, and firing
 * seven at once would put seven containers on a host sized for the one-run
 * path — the cost this feature's ledger insists on pricing before launching
 * rather than discovering. Returns the ids that launched; a row that fails to
 * launch stops the ladder rather than leaving a curve with a silent gap.
 */
export async function launchFeatureCountSweep(
  draftId: string,
  sweepId: string,
  /** AC66. The run whose importance produced `plan`'s shared ordering — every
   *  row records it, so the table can name the seed rather than crediting the
   *  ordering to whichever member the reader happens to open. */
  seedRunId: string,
  plan: SweepPlanRow[],
  base: Omit<
    CreateDraftRunInput,
    'featureColumns' | 'sweepId' | 'sweepSeedRunId'
  >,
): Promise<string[]> {
  const launched: string[] = []
  for (const step of plan) {
    const res = await modelDraftRunService.create(draftId, {
      ...base,
      featureColumns: step.features,
      sweepId,
      sweepSeedRunId: seedRunId,
    })
    if (res.data?.id) launched.push(res.data.id)
  }
  return launched
}
