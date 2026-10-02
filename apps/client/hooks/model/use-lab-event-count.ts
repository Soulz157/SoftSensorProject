'use client'

import { useEffect, useState } from 'react'
import { modelRunPredictionsService } from '@/services/model-retrain'
import type { LabEventSource } from '@/lib/retrain-lab-events'
import { labEventMetrics, type EventSpreads } from '@/lib/retrain-lab-events'
import type { MetricTriple } from '@/lib/retrain'
import type { RunPredictionPoint } from '@/services/model-draft'

export type LabEventCount =
  | { status: 'loading' }
  | {
      status: 'ready'
      events: number
      rows: number
      /** MODEL-SERVE-026-T03. Scored at lab-event rows — the primary figure. */
      atEvents: MetricTriple
      /** Scored over every row, as the server's own figure is. */
      allRows: MetricTriple
      /** MODEL-SERVE-026-T07. Target and error SD at the same lab events. */
      spreadsAtEvents: EventSpreads
      /** MODEL-SERVE-026-T04. The series itself, for event-by-event pairing. */
      points: readonly RunPredictionPoint[]
    }
  | { status: 'unavailable'; reason: string }

type Settled = Exclude<LabEventCount, { status: 'loading' }>

// One request per series per page: the basis label and the metric grid both
// ask for the same file. Failures are not cached, so a retry can succeed.
const inflight = new Map<string, Promise<Settled>>()

function load(
  modelId: string,
  runId: string,
  population: Extract<LabEventSource, { kind: 'series' }>['population'],
  key: string,
): Promise<Settled> {
  const existing = inflight.get(key)
  if (existing) return existing
  const pending = modelRunPredictionsService
    .get(modelId, runId, population)
    .then((res): Settled => {
      const points = res.data?.points ?? []
      return { status: 'ready', ...labEventMetrics(points), points }
    })
    .catch((err: unknown): Settled => {
      inflight.delete(key)
      return {
        status: 'unavailable',
        reason:
          err instanceof Error && err.message
            ? err.message
            : 'could not load this series',
      }
    })
  inflight.set(key, pending)
  return pending
}

/**
 * MODEL-SERVE-026-T02/T03. A figure's size in lab events and its scores at
 * those rows, derived client-side from the predictions file covering its
 * rows — the route already serves every population, so no trainer change and
 * no new column. Deliberately kept out of `EvalBasis`: that type is the
 * server's record, and these numbers are derived here, by a stated rule
 * (`labEventIndices` / `labEventMetrics`).
 *
 * A failed read reports the server's own message, like
 * `useRetrainPredictions`, never a generic one.
 */
export function useLabEventCount(
  modelId: string,
  source: LabEventSource,
): LabEventCount {
  const runId = source.kind === 'series' ? source.runId : null
  const population = source.kind === 'series' ? source.population : null
  const requestKey = `${modelId}|${runId}|${population}`
  // Keyed by the request it answers, so a stale answer reads as loading
  // without resetting state inside the effect.
  const [settled, setSettled] = useState<{
    key: string
    result: Settled
  } | null>(null)

  useEffect(() => {
    if (runId === null || population === null) return
    let cancelled = false
    void load(modelId, runId, population, requestKey).then(result => {
      if (!cancelled) setSettled({ key: requestKey, result })
    })
    return () => {
      cancelled = true
    }
  }, [modelId, runId, population, requestKey])

  if (source.kind === 'unavailable') {
    return { status: 'unavailable', reason: source.reason }
  }
  return settled?.key === requestKey ? settled.result : { status: 'loading' }
}
