'use client'

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { parseServerTimestamp, pickTimeFormat } from '@/lib/monitoring'
import {
  populationTitle,
  populationLabel,
  groupOmittedText,
  type EvaluationPopulation,
} from '@/lib/metric-source'
import { ALGORITHM_LABELS, type Algorithm } from '@/store/model-pipeline'
import type { RunPredictionsBatchItem } from '@/services/model-draft'
import { AXIS_TICK } from '../evaluation/actual-vs-predicted-chart'

/**
 * MODEL-FLOW-021-T02. The STRUCTURAL MINIMUM this chart actually reads —
 * widened from `CandidateResult` so Step 3's `RunComparisonPanel` can pass
 * its own `ModelTrainingRunListItem` rows (adapted `{ runId: r.id, … }`,
 * since a run row keys it `id`) without either a cast or a second copy of
 * this component. `CandidateResult` still satisfies it, so phase-4's own
 * call site is unchanged.
 *
 * Widening rather than copying is deliberate: `__tests__/model-selection-
 * contract.test.ts` greps THIS path for algorithm branching, and a copy
 * under `training-config/` would be silently uncovered by that guard.
 *
 */
export interface OverlaySeries {
  runId: string | null
  algorithm: string
}

interface Props {
  /** One comparable group. Phase-4 passes one phase group of ONE
   *  ModelCandidateJob (every candidate shares the job's own
   *  goldArtifactId/targetY/trainTestSplit, so they are split-comparable by
   *  construction); Step 3 passes one `groupByTarget` group. Either way the
   *  CALLER owns comparability — this chart merges every series onto one
   *  shared `actual` line and cannot detect a mixed target itself. */
  candidates: OverlaySeries[]
  byRunId: Map<string, RunPredictionsBatchItem>
  /**
   * MODEL-FLOW-019-T20. WHICH population every series here describes.
   *
   * REQUIRED and explicit, deliberately NOT derived per series from the
   * run's own scoring phase. `byRunId` is fetched one population at a time
   * (`predictionsBatch(..., population)`), so the caller is the only thing
   * that actually knows — and the derivation would be WRONG for exactly the
   * case this task added: `populationOf(cvScoringPhaseOf(nonCvRun))` is
   * `test-split` unconditionally, so a non-CV run's holdout series would
   * caption as Test. That is the conflation this whole feature exists to
   * prevent, arriving through a derivation that looks careful.
   *
   * A chart therefore never mixes populations; two populations are two
   * charts, each naming its own.
   */
  population: EvaluationPopulation
  /**
   * MODEL-FLOW-019 AC2. A qualifier the CALLER states beside a holdout
   * chart — in practice the holdout's own missing rate
   * (`holdoutMissingRateText`), which AC2 requires beside every figure that
   * source backs: the holdout is deliberately unimputed (DS-LAKE-018), so a
   * MISSING_VALUE hole reaches predict() and depresses the fit for reasons
   * that are not the model's fault. Optional because a test-split chart has
   * no such qualifier to make.
   */
  note?: string
  /**
   * MODEL-FLOW-019-T20 follow-up. WHY this chart has nothing to draw, when
   * no candidate has a series for `population`.
   *
   * Supplied by the caller, not derived, for the same reason `population`
   * is: this component sees `byRunId` for ONE population and cannot tell
   * "not applicable" from "not scored yet" from "failed to load" — only the
   * caller holds each candidate's `holdoutAbsence`/`cvFoldsKey`. See
   * `groupAbsenceText`, which produces exactly this string.
   *
   * Optional, and its absence keeps the old behaviour (render nothing), so
   * a caller that has no reason to give does not print a vague one.
   */
  absenceNote?: string
  /**
   * MODEL-FLOW-019-T20 follow-up. Rendered as a button inside the empty-
   * state frame, when present — the caller passes this only when
   * `scoreableRunIds(candidates)` (`lib/metric-source.ts`) is non-empty, so
   * a confirmed no-dataset-holdout group or one already `'scoring'` gets no
   * button that would only 400 or duplicate an in-flight request. Omitted
   * (`undefined`) renders the frame with no button at all — the caller's
   * job to decide, same as `absenceNote` above; this component has no
   * `draftId`/service access of its own to trigger scoring with.
   *
   * MODEL-FLOW-019-T29. This button's STANDING is not one thing — checked
   * before relabelling it, and deliberately left plain rather than
   * respelled to "backfill": a CV candidate that has never been scored
   * reaches this same button as its ONLY path to a holdout series (T26
   * never touches CV runs — "NON-CV ONLY" is that task's own point), while
   * a pre-T26 NON-CV candidate reaches it as the backfill path for a run
   * that predates the frame training now keeps inline. Renaming the label
   * to imply "backfill" would be true for the second case and wrong for
   * the first. The standing distinction lives in `absenceNote`
   * (`groupAbsenceText`/`candidateAbsenceText`, `lib/metric-source.ts`)
   * instead, which already varies per state — this button's own label
   * stays the one true sentence for both.
   */
  onScore?: () => void
  /** How many runIds `onScore` will act on — shown in the button's own
   *  label so a click's blast radius (how many scoring containers spawn)
   *  is visible before it happens. */
  scoreCount?: number
  /** True while a scoring request for this group is in flight OR at least
   *  one candidate here already carries a `scoringContainerId` — either way
   *  the button reads "Scoring…" and disables, rather than offering a
   *  second click that would spawn a second container for the same run. */
  scoring?: boolean
}

const OVERLAY_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

interface OverlayRow {
  t: number
  timestamp: string
  actual: number | null
  [predKey: string]: number | string | null
}

/**
 * Merges each candidate's OWN decimated series onto one shared timeline,
 * keyed by timestamp rather than assumed positionally aligned. Candidates
 * in the same job share an identical `y_true` — LTTB bucketing keyed on
 * (timestamp, y_true) (`run_predictions_batch`'s own docstring) therefore
 * keeps the SAME timestamps for every candidate, so `actual` agrees
 * wherever two candidates' series overlap; this still merges by key rather
 * than trusting that agreement, in case an artifact ever disagrees.
 */
// MODEL-FLOW-019-V34. Exported so a test can prove two runs with
// non-coincident timestamps each keep their own x value in the merge,
// rather than a positional (index) merge silently misaligning them.
export function buildOverlayRows(
  entries: { runId: string; item: RunPredictionsBatchItem }[],
): OverlayRow[] {
  const byTimestamp = new Map<string, OverlayRow>()
  for (const { runId, item } of entries) {
    for (const p of item.points) {
      let row = byTimestamp.get(p.timestamp)
      if (!row) {
        const t = parseServerTimestamp(p.timestamp)
        if (Number.isNaN(t)) continue
        row = {
          t,
          timestamp: p.timestamp,
          actual: p.yTrue,
        }
        byTimestamp.set(p.timestamp, row)
      }
      row[`pred_${runId}`] = p.yPred
    }
  }
  return Array.from(byTimestamp.values()).sort((a, b) => a.t - b.t)
}

/**
 * MODEL-FLOW-017. One full-width chart per phase group: actual once, each
 * candidate's prediction as its own series — divergence between close
 * candidates is directly comparable in a way no small multiple can be.
 * Answers a THIRD question, distinct from either per-candidate chart:
 * "which candidate tracks reality best", not "does this one" or "did it
 * converge".
 *
 * With no readable candidate it renders its own frame and STATES why
 * (`absenceNote`), rather than vanishing.
 *
 * It used to render nothing, justified by the small multiples below
 * carrying each candidate's own state. That justification was already
 * false for the holdout instance MODEL-FLOW-019-T20 added: there are no
 * holdout small multiples, so for that population this chart's absence was
 * the group's ONLY signal, and an absent signal is the one thing a reader
 * cannot interpret. A caller that passes no `absenceNote` still gets the
 * old silence.
 */
export function CandidateOverlayChart({
  candidates,
  byRunId,
  population,
  note,
  absenceNote,
  onScore,
  scoreCount,
  scoring,
}: Props) {
  const entries = candidates
    .filter(c => c.runId && byRunId.has(c.runId))
    .map(c => ({
      candidate: c,
      runId: c.runId as string,
      item: byRunId.get(c.runId as string) as RunPredictionsBatchItem,
    }))
    .filter(({ item }) => !item.error && item.points.length > 0)

  if (entries.length === 0) {
    if (!absenceNote) return null
    return (
      <div className="space-y-1.5 rounded-xl border border-dashed border-border/60 p-3">
        <p className="text-xs font-medium text-foreground">
            {populationTitle(population)} {' - '}
          <span className="font-normal text-muted-foreground">
          (Overall candidate comparison)
          </span>
        </p>
        <p className="text-[10px] text-muted-foreground">{absenceNote}</p>
        {onScore && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 cursor-pointer text-xs"
            disabled={scoring}
            onClick={onScore}
          >
            {scoring
              ? 'Scoring…'
              : scoreCount === 1
                ? 'Score against holdout'
                : `Score ${scoreCount ?? ''} candidates against holdout`}
          </Button>
        )}
      </div>
    )
  }

  const rows = buildOverlayRows(entries)
  const first = rows[0]
  const last = rows[rows.length - 1]
  const tickFormatter = pickTimeFormat(first && last ? last.t - first.t : 0)
  const anyDownsampled = entries.some(({ item }) => item.downsampled)
  const maxRowCount = Math.max(...entries.map(({ item }) => item.rowCount ?? 0))

  const seriesLabels = new Map<string, string>(
    entries.map(({ candidate, runId }, i) => {
      const label =
        ALGORITHM_LABELS[candidate.algorithm as Algorithm] ??
        candidate.algorithm
      const duplicate = entries.some(
        (other, j) =>
          j !== i && other.candidate.algorithm === candidate.algorithm,
      )
      return [`pred_${runId}`, duplicate ? `${label} #${i + 1}` : label]
    }),
  )
  seriesLabels.set('actual', 'Actual')

  // MODEL-FLOW-019-T20 follow-up. A PARTIALLY drawn group says which
  // candidates it left out. Silently dropping them is worse than the empty
  // case handled above: the heading still reads "Overall candidate
  // comparison", so an incomplete chart looks complete.
  const omittedText = groupOmittedText(
    new Set(entries.map(e => e.runId)),
    candidates.map(c => ({
      runId: c.runId,
      label: ALGORITHM_LABELS[c.algorithm as Algorithm] ?? c.algorithm,
    })),
  )

  return (
    <div className="space-y-1.5 rounded-xl border border-border/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-medium text-foreground">
            {populationTitle(population)} {' - '}
          <span className="font-normal text-muted-foreground">
          (Overall candidate comparison)
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" /> Actual
          </span>
          {entries.map(({ runId }, i) => (
            <span key={runId} className="flex items-center gap-1">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
                }}
              />
              {seriesLabels.get(`pred_${runId}`)}
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart
          data={rows}
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            scale="time"
            tickFormatter={tickFormatter}
            tick={AXIS_TICK}
            stroke="var(--border)"
            minTickGap={40}
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={AXIS_TICK}
            stroke="var(--border)"
            width={48}
            tickFormatter={v => Number(v).toFixed(1)}
          />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            labelFormatter={v => tickFormatter(Number(v))}
            formatter={(value: unknown, name: unknown) => [
              typeof value === 'number' ? value.toFixed(4) : '—',
              seriesLabels.get(String(name)) ?? String(name),
            ]}
          />
          <Line
            connectNulls
            type="monotone"
            dataKey="actual"
            stroke="var(--foreground)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {entries.map(({ runId }, i) => (
            <Line
              key={runId}
              connectNulls
              type="monotone"
              dataKey={`pred_${runId}`}
              stroke={OVERLAY_COLORS[i % OVERLAY_COLORS.length]}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground">
        Each candidate&apos;s prediction against one shared actual line, on the{' '}
        {populationLabel(population)}.{note ? ` ${note}` : ''}
        {omittedText ? ` ${omittedText}` : ''}
        {anyDownsampled
          ? ` ${rows.length} of ${maxRowCount} points shown per candidate.`
          : ''}
      </p>
    </div>
  )
}
