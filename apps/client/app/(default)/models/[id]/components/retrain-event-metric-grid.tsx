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
import { compareMetric } from '@/lib/retrain-metric-compare'
import { rmseDeltaClass } from '@/lib/retrain-verdict-style'
import { cn } from '@/lib/utils'
import type { LabEventIds } from './basis-lab-events'
import {
  RetrainMetricCompareCard,
  versionColumnLabel,
} from './retrain-metric-compare-card'

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
  candidateVersion = null,
  ids,
}: {
  view: ComparisonView
  currentVersion: number | null
  /** The new version's number for its column header; null = "New". */
  candidateVersion?: number | null
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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {METRICS.map(({ key, label }) => {
          const cand = primaryFigure(candidate, key, view.candidateMetrics[key])
          const inc = primaryFigure(incumbent, key, view.incumbentMetrics[key])
          // The delta is taken ONLY from the two figures on screen, and only
          // when both stand on the same basis. With one side at lab events
          // and the other on all rows, a verdict from the all-row pair could
          // contradict the two numbers the reader is looking at — so the
          // card shows none, and the all-row sentence below the grid speaks
          // for that comparison instead.
          const sameBasis = cand.basis !== 'pending' && cand.basis === inc.basis
          const comparison =
            view.comparable && sameBasis
              ? compareMetric(key, cand.value, inc.value)
              : null
          return (
            <RetrainMetricCompareCard
              key={key}
              label={label}
              newLabel={versionColumnLabel('New', candidateVersion)}
              currentLabel={versionColumnLabel('Current', currentVersion)}
              newValue={cand.basis === 'pending' ? 'pending' : cand.value}
              currentValue={inc.basis === 'pending' ? 'pending' : inc.value}
              newNotes={
                cand.basis === 'events'
                  ? [
                      `at ${cand.events.toLocaleString()} lab events`,
                      `all rows ${formatMetricValue(view.candidateMetrics[key])}`,
                    ]
                  : cand.basis === 'all-rows'
                    ? [`all rows — lab events unavailable (${cand.reason})`]
                    : ['scoring at lab events…']
              }
              currentNotes={
                inc.basis === 'events'
                  ? [
                      `at ${inc.events.toLocaleString()} lab events`,
                      `all rows ${formatMetricValue(view.incumbentMetrics[key])}`,
                    ]
                  : inc.basis === 'all-rows'
                    ? ['all rows']
                    : ['scoring at lab events…']
              }
              comparison={comparison}
              comparisonNote={
                cand.basis === 'events' ? 'at lab events' : 'all rows'
              }
            />
          )
        })}
      </div>
      {delta !== null && (
        <p className="text-xs text-muted-foreground">
          At lab events, RMSE{' '}
          <span className={cn('font-medium', rmseDeltaClass(delta))}>
            {delta < 0 ? 'improved' : 'regressed'}
          </span>{' '}
          by{' '}
          <span className="font-medium text-foreground">
            {Math.abs(delta).toFixed(4)}
          </span>{' '}
          vs. current v{currentVersion}.
        </p>
      )}
    </>
  )
}
