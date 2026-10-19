'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  groupAbsenceText,
  holdoutGroupMissingRateText,
  holdoutSeriesAbsenceOf,
  scoreableRunIds,
} from '@/lib/metric-source'
import {
  seriesStylesFor,
  toggleHiddenRun,
  visibleForCharts,
} from '@/lib/chart-model-filter'
import type {
  CandidateResult,
  RunPredictionsBatchItem,
} from '@/services/model-draft'
import { CandidateOverlayChart } from './candidate-overlay-chart'
import { OwnPopulationOverlays } from './own-population-overlays'

const FILTER_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

interface Props {
  /** One comparable group — every model the table below lists. */
  candidates: CandidateResult[]
  byRunId: Map<string, RunPredictionsBatchItem>
  holdoutByRunId: Map<string, RunPredictionsBatchItem>
  oofByRunId: Map<string, RunPredictionsBatchItem>
  oofError: string | null
  /** Score the given runs against the validation holdout. */
  onScore: (runIds: string[]) => void
  scoreSubmitting: boolean
}

/**
 * Phase 4's charts — the model's own population (test split, or out-of-fold
 * for a CV run) and Validate — with a filter above them to draw only the
 * models the user picks. Every model is drawn until the user hides some; the
 * table below is never filtered by it, and a model keeps its label and colour
 * whatever else is hidden (`seriesStylesFor`).
 *
 * Shared by the job path and the standalone path so the two cannot drift.
 * Scoring stays a fact about the whole group: the Validate chart's
 * "Score against validation" acts on every scoreable model, not just the ones
 * on screen.
 */
export function CandidateCharts({
  candidates,
  byRunId,
  holdoutByRunId,
  oofByRunId,
  oofError,
  onScore,
  scoreSubmitting,
}: Props) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  // Only a SUCCEEDED model can draw a line, so only those get a chip (and a
  // fixed label/colour); a failed one stays in the table with its reason.
  const styles = useMemo(
    () => seriesStylesFor(candidates.filter(c => c.status === 'SUCCEEDED')),
    [candidates],
  )
  const runIds = useMemo(() => [...styles.keys()], [styles])
  const visible = visibleForCharts(candidates, hidden)
  const hiddenCount = runIds.filter(id => hidden.has(id)).length

  const absence = visible.map(c => ({
    cvFoldsKey: c.cvFoldsKey,
    holdoutSeriesAbsence: holdoutSeriesAbsenceOf(c),
  }))
  const toScoreIds = scoreableRunIds(candidates)

  return (
    <div className="space-y-4">
      {runIds.length > 1 && (
        <div
          role="group"
          aria-label="Models shown in the charts"
          className="flex flex-wrap items-center gap-1.5"
        >
          <span className="mr-1 text-[11px] text-muted-foreground">
            Show in charts
          </span>
          {runIds.map(runId => {
            const style = styles.get(runId)!
            const shown = !hidden.has(runId)
            return (
              <button
                key={runId}
                type="button"
                aria-pressed={shown}
                onClick={() =>
                  setHidden(prev => toggleHiddenRun(prev, runId, runIds))
                }
                className={cn(
                  'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  shown
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground line-through hover:bg-muted',
                )}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      FILTER_COLORS[style.colorIndex % FILTER_COLORS.length],
                    opacity: shown ? 1 : 0.4,
                  }}
                />
                {style.label}
              </button>
            )
          })}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setHidden(new Set())}
              className="h-7 cursor-pointer rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Show all
            </button>
          )}
        </div>
      )}

      <OwnPopulationOverlays
        candidates={visible}
        byRunId={byRunId}
        oofByRunId={oofByRunId}
        oofError={oofError}
        seriesStyles={styles}
      />
      {/* MODEL-FLOW-019-T20. Validate sits beside the model's own population,
          never merged into it — the holdout is rows no fit ever saw. */}
      <CandidateOverlayChart
        candidates={visible}
        byRunId={holdoutByRunId}
        population="holdout"
        note={holdoutGroupMissingRateText(visible.map(c => c.sourcedMetrics))}
        absenceNote={groupAbsenceText('holdout', absence)}
        onScore={toScoreIds.length > 0 ? () => onScore(toScoreIds) : undefined}
        scoreCount={toScoreIds.length}
        scoring={scoreSubmitting || candidates.some(c => c.scoringContainerId)}
        seriesStyles={styles}
      />
    </div>
  )
}
