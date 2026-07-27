'use client'

import { useMemo, useRef } from 'react'
import type { AIModel } from '@/types'
import type { TimeRange } from '@/lib/mock-readings'
import type { EvalPoint } from '@/lib/model-evaluation'
import { generateLabComparison } from '@/lib/mock-lab-data'
import { readModelConfig, configTargets } from '@/lib/model-config'

interface UseMonitoringDataResult {
  points: EvalPoint[]
  /** Target variable (tag) the model predicts, for chart labelling. */
  tag: string
}

/**
 * Deterministic actual/predicted/residual series for one model over a range,
 * feeding the monitoring charts. Uses the approved mock lab layer
 * (`generateLabComparison`) with a `now` pinned once per mount so re-renders and
 * range switches don't reshuffle the data. Swap path: replace the generator with
 * a `services/` prediction-history fetch returning the same `EvalPoint[]`.
 */
export function useMonitoringData(
  model: AIModel | null,
  range: TimeRange,
): UseMonitoringDataResult {
  const now = useRef(Date.now()).current

  const points = useMemo(
    () => (model ? generateLabComparison(model.id, range, now) : []),
    [model, range, now],
  )

  const tag = useMemo(
    () => (model ? (configTargets(readModelConfig(model))[0] ?? '') : ''),
    [model],
  )

  return { points, tag }
}
