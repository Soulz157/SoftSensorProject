'use client'

import { useEffect, useState } from 'react'
import { modelRunCvGapService } from '@/services/model-retrain'
import { cvGapFolds, type CvGapSummary } from '@/lib/retrain-lab-events'

export type CvGapState =
  | { status: 'loading' }
  | { status: 'ready'; summary: CvGapSummary }
  | { status: 'unavailable'; reason: string }

/**
 * MODEL-SERVE-026-T05. A retrain candidate's cross-validation of the gap,
 * read once and summarised by `cvGapFolds` — the same lab-event rule as the
 * rest of the tab. A 404 reports the server's own reason (not requested, not
 * succeeded, or no series written — e.g. a trainer image older than the
 * feature), never a generic one.
 */
export function useCvGap(modelId: string, runId: string | null): CvGapState {
  const key = `${modelId}|${runId}`
  const [settled, setSettled] = useState<{
    key: string
    result: Exclude<CvGapState, { status: 'loading' }>
  } | null>(null)

  useEffect(() => {
    if (!runId) return
    let cancelled = false
    modelRunCvGapService
      .get(modelId, runId)
      .then(res => {
        if (!cancelled)
          setSettled({
            key,
            result: {
              status: 'ready',
              summary: cvGapFolds(res.data?.points ?? []),
            },
          })
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setSettled({
            key,
            result: {
              status: 'unavailable',
              reason:
                err instanceof Error && err.message
                  ? err.message
                  : 'could not load the cross-validation series',
            },
          })
      })
    return () => {
      cancelled = true
    }
  }, [modelId, runId, key])

  if (!runId)
    return { status: 'unavailable', reason: 'no finished new version' }
  return settled?.key === key ? settled.result : { status: 'loading' }
}
