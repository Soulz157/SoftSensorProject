'use client'

import { Loader2 } from 'lucide-react'
import { pickTimeFormat } from '@/lib/monitoring'
import { buildFitRows, type FitPoint } from '@/lib/model-metrics'
import { populationTitle, type EvaluationPopulation } from '@/lib/metric-source'
import type { RunPredictionsBatchItem } from '@/services/model-draft'
import { ActualVsPredictedChart } from '../evaluation/actual-vs-predicted-chart'

interface Props {
  /** Null means no run has been recorded for this candidate slot yet
   *  (still queued to launch) — distinct from a run that IS recorded but
   *  has not succeeded. */
  runId: string | null
  /**
   * MODEL-FLOW-019-T28. WHICH population this instance draws. REQUIRED,
   * deliberately never defaulted or derived — `populationOf(cvScoringPhaseOf(
   * run))` returns `'test-split'` unconditionally for a non-CV run, and this
   * ledger has now recorded that exact derivation creeping back in and
   * mislabelling a holdout series four times (T20's first pass, T20's
   * second pass, T27, T33). Only the CALLER, which fetched `item` from a
   * population-specific batch, actually knows.
   */
  population: EvaluationPopulation
  /** The candidate's own decimated series, once the batch fetch resolves.
   *  Absent (not merely `undefined`-valued) means the run never reached
   *  `useCandidatePredictions`' request — not yet SUCCEEDED, or has no key
   *  for THIS population at all. */
  item: RunPredictionsBatchItem | undefined
  loading: boolean
  /**
   * MODEL-FLOW-019-T28/T29. Why this instance has no series, when `item` is
   * absent — `lib/metric-source.ts`'s `candidateAbsenceText`, the
   * per-candidate twin of `groupAbsenceText`. Rendered in place of the
   * chart; never left as the generic "no predictions artifact" sentence,
   * which cannot tell a CV run's definitional absence (no action) from a
   * non-CV run's backfillable one (the group's own Score action, named in
   * words — this component offers no button of its own). `null`/`undefined`
   * (`candidateAbsenceText`'s own "nothing to explain" return) falls back
   * to the generic sentence, for a caller with nothing more specific to say.
   */
  absence?: string | null
  /** Small-multiple default. The overlay chart draws its own component
   *  entirely (`candidate-overlay-chart.tsx`), not this one. */
  height?: number
}

/**
 * MODEL-FLOW-017-T04, widened by MODEL-FLOW-019-T28 into two instances of
 * ONE component rather than a second one: the same actual-vs-predicted view,
 * told which population it is drawing via a required prop. Reuses
 * `ActualVsPredictedChart` rather than a second implementation of the same
 * view; NO branch on the algorithm field anywhere in this component
 * (finding 6) — every state below is keyed on the run's own recorded
 * predictions fields, never on which estimator produced them.
 */
export function CandidateBaseChart({
  runId,
  population,
  item,
  loading,
  absence,
  height = 140,
}: Props) {
  if (!runId) return null

  if (loading) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ height }}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  // MODEL-FLOW-019-T28. NEVER an empty axis — the same rule T20 established
  // for the group overlay applies per candidate, with the reason named.
  // `absence` (the caller's own fact) always wins over the generic sentence
  // below, since it is the common case for a Validate chart specifically
  // (a run with no series for this population simply has no `item` here).
  if (!item) {
    return (
      <p className="text-[10px] text-muted-foreground">
        {absence ?? 'No predictions artifact recorded for this run.'}
      </p>
    )
  }

  if (item.error || item.points.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground">
        Predictions could not be read
        {item.error ? ` — ${item.error}` : '.'}
      </p>
    )
  }

  const points: FitPoint[] = item.points.map(p => ({
    timestamp: p.timestamp,
    actual: p.yTrue,
    predicted: p.yPred,
    residual: p.yTrue - p.yPred,
  }))
  const rows = buildFitRows(points, item.residualSd ?? 0)
  const first = rows[0]
  const last = rows[rows.length - 1]
  const tickFormatter = pickTimeFormat(first && last ? last.t - first.t : 0)

  return (
    <div className="space-y-1">
      <p className="text-[12px] text-foreground">
        {populationTitle(population)}
      </p>
      <span className="text-muted-foreground text-[10px]">
        actual vs. predicted values
      </span>
      <ActualVsPredictedChart
        rows={rows}
        tickFormatter={tickFormatter}
        height={height}
        // MODEL-FLOW-019-T28. Population-qualified — the Test and Validate
        // instances for one candidate would otherwise share
        // `candidate-base-${runId}` and recharts would sync one crosshair
        // across two windows with no overlapping timestamps (T26's live
        // read: holdout 27-31 Jan against test 21-27 Feb for the same run).
        syncId={`candidate-base-${runId}-${population}`}
      />
      {/* MODEL-FLOW-019 AC65. Unconditional, not gated on `downsampled` —
          a small holdout frame (as few as 40 rows) is never decimated and
          would otherwise print no count at all, the exact case this task
          says only the count can disambiguate from a much larger test
          split. */}
      <p className="text-[9px] text-muted-foreground">
        {item.points.length} of {item.rowCount} points shown
      </p>
    </div>
  )
}
