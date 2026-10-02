'use client'

import { formatMetricValue } from '@/lib/model-evaluation'
import type { ComparisonView } from '@/lib/retrain'
import {
  eventRmseDelta,
  labEventSource,
  primaryFigure,
  type LabEventSource,
} from '@/lib/retrain-lab-events'
import { useLabEventCount } from '@/hooks/model/use-lab-event-count'
import type { LabEventIds } from './basis-lab-events'

const METRICS: { key: 'rmse' | 'r2' | 'mae'; label: string }[] = [
  { key: 'rmse', label: 'RMSE' },
  { key: 'r2', label: 'R²' },
  { key: 'mae', label: 'MAE' },
]

const NOT_REQUESTED: LabEventSource = {
  kind: 'unavailable',
  reason: 'no recorded basis for this figure',
}

/**
 * MODEL-SERVE-026-T03 (openDecision 2). The comparison grid with the figure
 * scored at LAB-EVENT rows as the primary number, and the server's all-row
 * figure kept beneath it, labelled — so nothing stored changes meaning and a
 * reader sees both. The SAME rule (`labEventMetrics`) scores the new and the
 * current version, never one per panel.
 */
export function RetrainEventMetricGrid({
  view,
  currentVersion,
  ids,
}: {
  view: ComparisonView
  currentVersion: number | null
  ids: LabEventIds
}) {
  const candidate = useLabEventCount(
    ids.modelId,
    view.candidateMetricsBasis
      ? labEventSource(view.candidateMetricsBasis, 'candidate', ids)
      : NOT_REQUESTED,
  )
  const incumbent = useLabEventCount(
    ids.modelId,
    labEventSource(view.incumbentMetricsBasis, 'incumbent', ids),
  )
  const delta = eventRmseDelta(candidate, incumbent, view.comparable)

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {METRICS.map(({ key, label }) => {
          const cand = primaryFigure(candidate, key, view.candidateMetrics[key])
          const inc = primaryFigure(incumbent, key, view.incumbentMetrics[key])
          return (
            <div
              key={key}
              className="flex flex-col gap-1 rounded-md bg-muted/30 p-3 ring-1 ring-foreground/20"
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <p className="text-lg font-semibold tabular-nums text-foreground">
                {cand.basis === 'pending' ? '…' : formatMetricValue(cand.value)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {cand.basis === 'events'
                  ? `at ${cand.events.toLocaleString()} lab events`
                  : cand.basis === 'all-rows'
                    ? `all rows — lab events unavailable (${cand.reason})`
                    : 'scoring at lab events…'}
              </p>
              {cand.basis === 'events' && (
                <p className="text-[10px] text-muted-foreground">
                  all rows {formatMetricValue(view.candidateMetrics[key])}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                current v{currentVersion}{' '}
                {inc.basis === 'events'
                  ? `${formatMetricValue(inc.value)} at lab events · ${formatMetricValue(view.incumbentMetrics[key])} all rows`
                  : `${formatMetricValue(view.incumbentMetrics[key])} all rows`}
              </p>
            </div>
          )
        })}
      </div>
      {delta !== null && (
        <p className="text-xs text-muted-foreground">
          At lab events, RMSE {delta < 0 ? 'improved' : 'regressed'} by{' '}
          <span className="font-medium text-foreground">
            {Math.abs(delta).toFixed(4)}
          </span>{' '}
          vs. current v{currentVersion}.
        </p>
      )}
    </>
  )
}
