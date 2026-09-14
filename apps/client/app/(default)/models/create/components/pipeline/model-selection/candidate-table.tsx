'use client'

import { Fragment, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Loader2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { ALGORITHM_LABELS, type Algorithm } from '@/store/model-pipeline'
import {
  criterionLabel,
  evaluateCriterion,
  isLegacyCriterion,
  type AcceptanceCriterion,
  type ComparisonFigures,
  type OperandAbsence,
} from '@/lib/acceptance-criteria'
import {
  residualSdOf,
  type ResidualSdAbsence,
  type ResidualSdCell,
} from '@/lib/residual-sd'
import { cvScoringPhaseOf } from '@/hooks/model/use-draft-run-evaluation'
import { METRIC_META, type MetricKey } from '@/lib/model-metrics'
import {
  METRIC_SOURCE_LABELS,
  candidateAbsenceText,
  metricValueOf,
  type CvFoldEstimate,
  type SourcedMetrics,
} from '@/lib/metric-source'
import {
  RANK_DIRECTION,
  rankCandidates,
  rankingSummaryText,
  type RankMetricKey,
  type UnrankedReason,
} from '@/lib/metric-ranking'
import { classifyHyperparams } from '@/lib/run-params'
import type {
  CandidateResult,
  RunPredictionsBatchItem,
} from '@/services/model-draft'
import { CandidateBaseChart } from './candidate-base-chart'
import { CandidateChart } from './candidate-chart'

export const STATUS_META: Record<
  CandidateResult['status'],
  { label: string; icon: typeof Clock; className: string }
> = {
  PENDING: {
    label: 'Pending',
    icon: Circle,
    className: 'text-muted-foreground',
  },
  QUEUED: { label: 'Queued', icon: Clock, className: 'text-muted-foreground' },
  RUNNING: {
    label: 'Running',
    icon: Loader2,
    className: 'text-primary animate-spin',
  },
  SUCCEEDED: {
    label: 'Succeeded',
    icon: CheckCircle2,
    className: 'text-emerald-500',
  },
  FAILED: { label: 'Failed', icon: AlertTriangle, className: 'text-red-500' },
  CANCELED: {
    label: 'Canceled',
    icon: AlertTriangle,
    className: 'text-muted-foreground',
  },
}

function CandidateHyperparams({ candidate }: { candidate: CandidateResult }) {
  const rows = classifyHyperparams(
    candidate.algorithm,
    candidate.hyperparameters,
  )
  if (rows.length === 0) return null
  return (
    <p className="truncate text-[10px] text-muted-foreground">
      {rows.map(r => `${r.label}: ${String(r.value)}`).join(' · ')}
    </p>
  )
}

/**
 * MODEL-FLOW-019-T03. Why an unrankable row has no rank number, said in the
 * table rather than left as a bare dash — the same "keep the row, state the
 * reason" discipline MODEL-FLOW-013-T07 already established for a FAILED
 * candidate's chart frame.
 */
export const UNRANKED_LABELS: Record<UnrankedReason, string> = {
  'no-run': 'Not launched yet',
  'not-finished': 'Still running',
  failed: 'Did not finish',
  'missing-metric': 'No score for this metric',
  'no-shared-source': 'Mixed sources — not ranked',
}

/** MODEL-FLOW-019-T10. Reverses T04's own "sd is not a table column" — that
 *  reasoning was true of the run row (`metrics`/`holdoutMetrics`/a CV fold
 *  aggregate never carry it) and false of the source this table now reads,
 *  `useCandidatePredictions`' own batch response (`residualSdOf`, below).
 *  `RankMetricKey` still excludes `sd` (`lib/metric-ranking.ts`'s own
 *  `RANK_DIRECTION`) — read directly off that table rather than a second
 *  list, so a metric is rankable here iff it is rankable there. */
export function isRankMetricKey(key: MetricKey): key is RankMetricKey {
  return key in RANK_DIRECTION
}

/** MODEL-FLOW-019-T10. Fixed column order so `sd` renders beside `rmse` —
 *  `residual_SD <= RMSE` always, and the gap between them IS the model's
 *  bias, readable by eye only when the two are adjacent rather than
 *  separated by `mae`. Independent of pick order in `mpSelectedMetricsAtom`. */
export const STEP4_COLUMN_ORDER: readonly MetricKey[] = [
  'r2',
  'rmse',
  'sd',
  'mae',
]

/**
 * One metric's two source columns — never merged into one cell (finding 3;
 * MODEL-FLOW-019 AC10). `metric` is the tagged value ITSELF, read via
 * `metricValueOf`, so a cell literally cannot show a number without also
 * having the source it came from in hand.
 */
/** MODEL-FLOW-019-T07 follow-up. The Validate (holdout) column, and only
 *  that column, in every metric group — the one thresholds actually bind
 *  to since the form went holdout-only. A quiet primary-tinted left
 *  border + background, not a loud one: it marks the column, it does not
 *  compete with the pass/fail marks inside it (those stay uncoloured per
 *  AC13's own advisory, never-alarming rule). */
export const VALIDATE_COLUMN_CLASS = 'border-l border-primary/30 bg-primary/5'

export function MetricSourceCell({
  metric,
  metricKey,
  emptyReason,
  highlighted,
}: {
  metric: SourcedMetrics | null
  metricKey: RankMetricKey
  /** Only meaningful when `metric` is null — the three-facts text AC11
   *  requires for an absent holdout figure. Undefined for the Test column,
   *  which has no such reason to report (a non-CV SUCCEEDED run always has
   *  a test-split figure; a CV or non-terminal row shows a plain dash,
   *  matching this table's pre-existing Test-column behaviour). */
  emptyReason?: string
  /** Marks this as the Validate (holdout) column — see
   *  `VALIDATE_COLUMN_CLASS`'s own doc comment. */
  highlighted?: boolean
}) {
  if (!metric) {
    return (
      <TableCell
        className={cn('text-right', highlighted && VALIDATE_COLUMN_CLASS)}
      >
        {emptyReason ? (
          <span className="text-[10px] text-muted-foreground italic">
            {emptyReason}
          </span>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    )
  }
  const value = metricValueOf(metric, metricKey)
  return (
    <TableCell
      className={cn('text-right', highlighted && VALIDATE_COLUMN_CLASS)}
    >
      <p className="font-mono text-xs tabular-nums text-foreground">
        {value === null ? '—' : value.toFixed(3)}
      </p>
    </TableCell>
  )
}

/** MODEL-FLOW-019-T10. Absent SD, three honest causes plus the plain-dash
 *  non-terminal case (`lib/residual-sd.ts`'s own doc comment) — the same
 *  three-facts discipline `HOLDOUT_ABSENCE_TEXT` already applies to a
 *  missing holdout figure. `unreadable` appends the batch item's own error,
 *  the way `candidate-base-chart.tsx`'s "Predictions could not be read"
 *  state already does — that cause hides a real defect and must never
 *  collapse into the same dash as a dataset that simply has no series. */
const RESIDUAL_SD_ABSENCE_TEXT: Record<ResidualSdAbsence, string> = {
  'awaiting-scoring': 'Awaiting scoring',
  scoring: 'Scoring…',
  'no-series': 'No predictions series',
  unreadable: 'Unreadable',
  'not-recorded': 'Not recorded',
  // MODEL-FLOW-019-T33. Terminal and definitional — a cross-validated run
  // never had a test split, so this is not unscored work with an action
  // attached. Same asymmetry T28 states for its own two charts.
  'no-test-split': 'No test split (cross-validated)',
  'no-dataset-holdout': 'No holdout in this dataset',
  // MODEL-FLOW-019-T29's collapse, honoured here too: `aggregate-only` and
  // `not-scored-yet` share ONE remedy, so they read the same on screen while
  // staying separate type members — the decision T29 recorded, naming this
  // task as the reason to keep them apart at the type level.
  'aggregate-only': 'Not scored against the holdout',
  'not-scored-yet': 'Not scored against the holdout',
  'sequence-not-scoreable': 'Not available for a sequence model',
}

/** One SD figure — or its reason — for ONE column.
 *
 *  MODEL-FLOW-019-T33 removed the call-site branch this used to carry ("never
 *  called for the OTHER column: that one renders a plain dash"). Both columns
 *  now call it, each with its own cell, because both now have a reason to
 *  give: the dash was the only thing a reader ever saw in the empty column,
 *  and a definitional absence (a CV run has no test split) looked identical
 *  to a fixable one (this run was never scored). */
function SdCellBody({ cell }: { cell: ResidualSdCell }) {
  if (cell.value !== null) {
    return (
      <p className="font-mono text-xs tabular-nums text-foreground">
        {cell.value.toFixed(3)}
      </p>
    )
  }
  if (!cell.absence) {
    return <span className="font-mono text-xs text-muted-foreground">—</span>
  }
  const reason =
    RESIDUAL_SD_ABSENCE_TEXT[cell.absence] +
    (cell.errorText ? ` — ${cell.errorText}` : '')
  return (
    <span className="text-[10px] text-muted-foreground italic">{reason}</span>
  )
}

/** MODEL-FLOW-019. Three facts, three different next actions — never one
 *  blank cell (AC11), reused here for an absent COMPARISON operand rather
 *  than a candidate's headline holdout figure. `cross-validation` is the
 *  AC28/V18 guard naming itself when it fires. */
const OPERAND_ABSENCE_TEXT: Record<OperandAbsence, string> = {
  'no-dataset-holdout': 'no holdout',
  'not-scored-yet': 'awaiting scoring',
  'not-recorded': 'not recorded',
  'awaiting-scoring': 'awaiting scoring',
  scoring: 'scoring…',
  'no-series': 'no predictions series',
  unreadable: 'unreadable',
  'cross-validation': 'fold estimate, not a run measurement',
  // MODEL-FLOW-019-T33. Reached once an SD operand can resolve to the TEST
  // population on a cross-validated run, which has none.
  'no-test-split': 'no test split',
  'aggregate-only': 'awaiting scoring',
  'sequence-not-scoreable': 'not scoreable for a sequence model',
}

/**
 * MODEL-FLOW-019-T12 AC12/AC13/AC1. One line per configured criterion — a
 * shape icon plus the comparison, e.g. "✓ Validate RMSE < Test RMSE" —
 * never a colour-coded pass/fail (red/amber are reserved for
 * workspace+plant status elsewhere in this codebase), and never hiding,
 * filtering, or disabling anything else on the row (AC13). A legacy
 * criterion (T07's or T11's shape) is filtered out before evaluation
 * rather than reaching `evaluateCriterion` with fields it does not have
 * (V19) — Step 3's own migration strip is where it is surfaced and
 * cleared.
 */
function RowCriteriaMarks({
  criteria,
  figures,
}: {
  criteria: AcceptanceCriterion[]
  figures: ComparisonFigures
}) {
  const current = criteria.filter(
    (c): c is AcceptanceCriterion => !isLegacyCriterion(c),
  )
  if (current.length === 0) return null
  return (
    <div className="space-y-0.5">
      {current.map((criterion, i) => {
        const evaluation = evaluateCriterion(criterion, figures)
        const label = criterionLabel(criterion)
        if (evaluation.verdict === 'not-evaluated') {
          const reason = evaluation.left.absence ?? evaluation.right.absence
          return (
            <p key={i} className="text-[9px] italic text-muted-foreground">
              {label} — not evaluated
              {reason && ` (${OPERAND_ABSENCE_TEXT[reason]})`}
            </p>
          )
        }
        const Icon =
          evaluation.verdict === 'pass' ? CheckCircle2 : AlertTriangle
        return (
          <p
            key={i}
            className="flex flex-col items-end gap-0 text-[9px] text-muted-foreground"
          >
            <span className="flex items-center gap-0.5">
              <Icon className="h-2.5 w-2.5 shrink-0" />
              {label}
            </span>
            {evaluation.left.value !== null &&
              evaluation.right.value !== null && (
                <span>
                  {evaluation.left.value.toFixed(2)} /{' '}
                  {evaluation.right.value.toFixed(2)}
                </span>
              )}
          </p>
        )
      })}
    </div>
  )
}

/**
 * MODEL-FLOW-019-T08 part 4. A CV run's fold estimate — mean AND spread,
 * labelled `Est. CV` (`METRIC_SOURCE_LABELS`), never merged into an
 * ordinary `MetricSourceCell`'s single-value shape. `StandaloneRunRow`
 * already rendered this correctly (`0.400 ± 0.050`, "Est. CV RMSE") before
 * it was deleted for this same task's "one layout" rule — the unified
 * table must inherit that discipline, not replace it with a bare
 * "N/A": a CV run is reachable from the standalone path (never from a
 * candidate job, per this column's own history below) and would otherwise
 * show no figure of any kind for its own headline number.
 */
function CvEstimateCell({
  metric,
  metricKey,
}: {
  metric: CvFoldEstimate
  metricKey: RankMetricKey
}) {
  const mean = metric.mean[metricKey]
  const std = metric.std[metricKey]
  return (
    <TableCell className="border-l text-right">
      <p className="font-mono text-xs tabular-nums text-foreground">
        {mean === null
          ? '—'
          : `${mean.toFixed(3)}${std !== null ? ` ± ${std.toFixed(3)}` : ''}`}
      </p>
      <p className="text-[9px] text-muted-foreground">
        {METRIC_SOURCE_LABELS['cv-fold-estimate']}
      </p>
    </TableCell>
  )
}

/**
 * MODEL-FLOW-019-T04. Replaces the per-candidate card grid with a genuine
 * sortable table — one row per candidate, both a Test and a Holdout column
 * for every metric the picker has selected (never merged, per finding 3),
 * ranked via `rankCandidates` (T03) so the ordering's own source is stated
 * once above the table rather than implied per cell.
 *
 * MODEL-FLOW-019-T06 (resolved 2026-09-06 — "reveal on row select"):
 * MODEL-FLOW-017's per-candidate base and diagnostic charts render INSIDE
 * this table, in an extra row directly under a candidate's own row, opened
 * by that row's own chevron toggle — never all at once. A table of 10 rows
 * with two charts each rendered unconditionally is 20 charts under one
 * sortable header, which is not a table (this task's own stated problem);
 * nothing renders until asked for, so the table stays a table regardless of
 * candidate count. Only a SUCCEEDED candidate with a `runId` gets a toggle —
 * there is nothing to chart for any other status.
 */
export function CandidateTable({
  candidates,
  resolvedRunId,
  selecting,
  onSelect,
  selectedMetrics,
  sortMetric,
  onSortMetric,
  byRunId,
  holdoutByRunId,
  predictionsLoading,
  holdoutLoading,
  rowNote,
  rowAction,
  chartMode = 'full',
  criteria,
}: {
  candidates: CandidateResult[]
  resolvedRunId: string | null
  selecting: boolean
  onSelect: (runId: string) => void
  selectedMetrics: MetricKey[]
  sortMetric: RankMetricKey
  onSortMetric: (key: RankMetricKey) => void
  byRunId: Map<string, RunPredictionsBatchItem>
  /** MODEL-FLOW-019-T28. The same candidates' HOLDOUT series — already
   *  fetched by every caller for the group overlay above this table; the
   *  expanded row's Validate chart reads it too, no third fetch. */
  holdoutByRunId: Map<string, RunPredictionsBatchItem>
  predictionsLoading: boolean
  holdoutLoading: boolean
  rowNote?: (runId: string) => React.ReactNode
  rowAction?: (runId: string) => React.ReactNode
  chartMode?: 'full' | 'predictions-only'
  /** MODEL-FLOW-019-T07. Advisory thresholds — annotates cells, never
   *  filters/hides/blocks a row. Defaults to none set. */
  criteria?: AcceptanceCriterion[]
}) {
  const ranking = useMemo(
    () => rankCandidates(candidates, sortMetric),
    [candidates, sortMetric],
  )
  const summary = rankingSummaryText(ranking)
  // Per-row disclosure state — local to this table (one per phase group),
  // reset whenever a fresh group mounts rather than persisted, matching the
  // ephemeral view-preference treatment `sortMetric` already gets.
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(
    () => new Set(),
  )
  const toggleExpanded = (runId: string) =>
    setExpandedRunIds(prev => {
      const next = new Set(prev)
      if (next.has(runId)) next.delete(runId)
      else next.add(runId)
      return next
    })
  // MODEL-FLOW-019-T10. Fixed order (`STEP4_COLUMN_ORDER`), not pick order
  // — `sd` renders beside `rmse` regardless of when the user selected it.
  const visibleMetrics: MetricKey[] = STEP4_COLUMN_ORDER.filter(key =>
    selectedMetrics.includes(key),
  )
  const hasCriteria = (criteria ?? []).length > 0

  // rank + algorithm + status + two columns per selected metric + an
  // optional criteria column + actions — the chart row spans every column
  // so it reads as one panel, not a cell.
  const totalCols = 3 + visibleMetrics.length * 2 + (hasCriteria ? 1 : 0) + 1

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">{summary}</p>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="align-bottom">
                #
              </TableHead>
              <TableHead rowSpan={2} className="align-bottom">
                Algorithm
              </TableHead>
              <TableHead rowSpan={2} className="align-bottom">
                Status
              </TableHead>
              {visibleMetrics.map(key => {
                const sortable = isRankMetricKey(key)
                const active = sortable && sortMetric === key
                return (
                  <TableHead
                    key={key}
                    colSpan={2}
                    aria-sort={
                      !active ? 'none' : RANK_ARIA[key as RankMetricKey]
                    }
                    className="border-l text-center"
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className={cn(
                          'inline-flex cursor-pointer items-center gap-1',
                          active
                            ? 'font-semibold text-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                        onClick={() => onSortMetric(key)}
                        title={`Rank by ${METRIC_META[key].label}`}
                      >
                        {METRIC_META[key].label}
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    ) : (
                      <span
                        className="text-muted-foreground"
                        title="Not a sort target — ranking by residual scatter would sort a biased model with tight scatter above an unbiased one with wider scatter."
                      >
                        {METRIC_META[key].label}
                      </span>
                    )}
                  </TableHead>
                )
              })}
              {hasCriteria && (
                <TableHead rowSpan={2} className="border-l align-bottom">
                  Criteria
                </TableHead>
              )}
              <TableHead rowSpan={2} className="align-bottom" />
            </TableRow>
            <TableRow>
              {visibleMetrics.map(key => (
                <Fragment key={key}>
                  <TableHead className="border-l text-right text-[10px] font-normal">
                    Test
                  </TableHead>
                  <TableHead
                    className={cn(
                      'text-right text-[10px] font-normal',
                      VALIDATE_COLUMN_CLASS,
                    )}
                  >
                    Validate
                  </TableHead>
                </Fragment>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranking.entries.map(entry => {
              const candidate = entry.row
              const algorithmLabel =
                ALGORITHM_LABELS[candidate.algorithm as Algorithm] ??
                candidate.algorithm
              const status = STATUS_META[candidate.status]
              const StatusIcon = status.icon
              const isSelected = candidate.runId === resolvedRunId
              const testMetric =
                candidate.sourcedMetrics.find(m => m.source !== 'holdout') ??
                null
              const holdoutMetric =
                candidate.sourcedMetrics.find(m => m.source === 'holdout') ??
                null
              // A candidate whose only non-holdout source is a CV fold
              // estimate has no TEST-SPLIT figure at all (finding (g) — a CV
              // run's `metrics` carries no bare rmse/r2/mae). MODEL-FLOW-
              // 019-T08 part 4: reachable from the standalone path (a CV
              // run launched one at a time, never from a candidate job —
              // CreateCandidateJob's own schema has no `nSplits` field), so
              // the cell renders the fold estimate itself
              // (`CvEstimateCell`, its own mean+std, labelled `Est. CV` —
              // never under the plain "Test" shape, which would be the
              // merge-two-sources-into-one-column mistake this feature
              // exists to prevent) — UNLESS the run has since been SCORED,
              // in which case the real holdout figure in the next column
              // supersedes it; showing an ESTIMATE beside a MEASUREMENT as
              // though comparable is `StandaloneRunRow`'s own "drop the
              // pre-scoring note once scored" rule, inherited here.
              const cvPhase = cvScoringPhaseOf(candidate)
              // MODEL-FLOW-019-T10. Computed once per row and reused for
              // both the SD column and the Criteria column's ratio
              // evaluation, so the two never disagree about which
              // population this run's SD is a figure of.
              // MODEL-FLOW-019-T33. TWO cells, one per column, each read
              // from the batch its own column belongs to — no third fetch,
              // since T20 already issues both and T28 already passes both
              // down. Before this, ONE cell was derived and routed to
              // whichever column its own source happened to name, leaving
              // the other column a bare dash that explained nothing: a
              // non-CV run's Validate SD and a scored CV run's Test SD were
              // equally silent, though only one of them is definitional.
              const sdTest = residualSdOf(
                candidate,
                candidate.runId ? byRunId.get(candidate.runId) : undefined,
                predictionsLoading,
                'test-split',
              )
              const sdValidate = residualSdOf(
                candidate,
                candidate.runId
                  ? holdoutByRunId.get(candidate.runId)
                  : undefined,
                holdoutLoading,
                'holdout',
              )
              const comparisonFigures: ComparisonFigures = {
                sourcedMetrics: candidate.sourcedMetrics,
                // Both, so a criterion comparing a Validate SD against a Test
                // SD reads the same two numbers the row displays. Passing one
                // cell for both operands is the conflation this feature
                // exists to prevent, arriving through the criteria path.
                residualSd: { 'test-split': sdTest, holdout: sdValidate },
                holdoutAbsence: candidate.holdoutAbsence,
              }
              const canChart =
                candidate.status === 'SUCCEEDED' && Boolean(candidate.runId)
              const isExpanded = Boolean(
                candidate.runId && expandedRunIds.has(candidate.runId),
              )
              const rowKey = `${candidate.algorithm}-${candidate.phase}-${candidate.runId ?? 'pending'}`
              return (
                <Fragment key={rowKey}>
                  <TableRow data-state={isSelected ? 'selected' : undefined}>
                    <TableCell
                      className="text-muted-foreground"
                      title={
                        entry.unranked
                          ? UNRANKED_LABELS[entry.unranked]
                          : undefined
                      }
                    >
                      {entry.rank ?? '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <StatusIcon
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            status.className,
                          )}
                        />
                        <span className="font-medium text-foreground">
                          {algorithmLabel}
                        </span>
                        {isSelected && (
                          <Badge
                            variant="secondary"
                            className="h-4 px-1.5 text-[9px]"
                          >
                            Selected
                          </Badge>
                        )}
                      </div>
                      <CandidateHyperparams candidate={candidate} />
                      {candidate.runId && rowNote?.(candidate.runId)}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {status.label}
                      </span>
                      {candidate.failureReason && (
                        <p className="text-[11px] text-red-500">
                          {candidate.failureReason}
                        </p>
                      )}
                    </TableCell>
                    {visibleMetrics.map(key =>
                      isRankMetricKey(key) ? (
                        <Fragment key={key}>
                          {testMetric?.source === 'cv-fold-estimate' &&
                          cvPhase !== 'scored' ? (
                            <CvEstimateCell
                              metric={testMetric}
                              metricKey={key}
                            />
                          ) : (
                            <MetricSourceCell
                              metric={
                                testMetric?.source === 'cv-fold-estimate'
                                  ? null
                                  : testMetric
                              }
                              metricKey={key}
                            />
                          )}
                          <MetricSourceCell
                            metric={holdoutMetric}
                            metricKey={key}
                            emptyReason={
                              candidate.holdoutAbsence
                                ? HOLDOUT_ABSENCE_TEXT[candidate.holdoutAbsence]
                                : undefined
                            }
                            highlighted
                          />
                        </Fragment>
                      ) : (
                        // Only `sd` reaches here — every rank-metric key
                        // (r2/rmse/mae) takes the branch above.
                        <Fragment key={key}>
                          <TableCell className="border-l text-right">
                            <SdCellBody cell={sdTest} />
                          </TableCell>
                          <TableCell
                            className={cn('text-right', VALIDATE_COLUMN_CLASS)}
                          >
                            <SdCellBody cell={sdValidate} />
                          </TableCell>
                        </Fragment>
                      ),
                    )}
                    {hasCriteria && (
                      <TableCell className="border-l">
                        <RowCriteriaMarks
                          criteria={criteria ?? []}
                          figures={comparisonFigures}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        {canChart && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 cursor-pointer px-1.5 text-xs text-muted-foreground hover:text-foreground"
                            aria-expanded={isExpanded}
                            aria-label={
                              isExpanded ? 'Hide charts' : 'Show charts'
                            }
                            onClick={() =>
                              toggleExpanded(candidate.runId as string)
                            }
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        {candidate.runId && rowAction?.(candidate.runId)}
                        {candidate.status === 'SUCCEEDED' &&
                          !isSelected &&
                          candidate.runId && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 cursor-pointer px-2 text-xs"
                              disabled={selecting}
                              onClick={() =>
                                onSelect(candidate.runId as string)
                              }
                            >
                              Select
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && candidate.runId && (
                    <TableRow>
                      <TableCell colSpan={totalCols} className="bg-muted/30">
                        <div className="grid gap-4 p-2 sm:grid-cols-1">
                          {/* MODEL-FLOW-019-T28. The same Test/Validate pair
                              the group overlay above already draws, now per
                              candidate — two instances of ONE component,
                              stacked (never side by side: two time-axis
                              charts squeezed into a table row sized for
                              metric columns would render both unreadable,
                              the same aspect-ratio trap T17 recorded for the
                              parity chart). Each names its own population
                              and its own absence reason — never a shared,
                              derived one. */}
                          <CandidateBaseChart
                            runId={candidate.runId}
                            population="test-split"
                            item={byRunId.get(candidate.runId)}
                            loading={predictionsLoading}
                            absence={candidateAbsenceText(
                              candidate,
                              'test-split',
                            )}
                          />
                          <CandidateBaseChart
                            runId={candidate.runId}
                            population="holdout"
                            item={holdoutByRunId.get(candidate.runId)}
                            loading={holdoutLoading}
                            absence={candidateAbsenceText(candidate, 'holdout')}
                          />
                          {chartMode !== 'predictions-only' && (
                            <CandidateChart candidate={candidate} />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/** MODEL-FLOW-019 AC11. Three facts, three different next actions — never
 *  one blank cell. `null` (a figure IS present) is handled by the caller,
 *  which never reaches this map in that case. */
const HOLDOUT_ABSENCE_TEXT: Record<
  NonNullable<CandidateResult['holdoutAbsence']>,
  string
> = {
  'no-dataset-holdout': 'No holdout',
  'not-scored-yet': 'Awaiting scoring',
  'not-recorded': 'Not recorded',
}

export const RANK_ARIA: Record<RankMetricKey, 'ascending' | 'descending'> = {
  rmse: 'ascending',
  mae: 'ascending',
  r2: 'descending',
}
