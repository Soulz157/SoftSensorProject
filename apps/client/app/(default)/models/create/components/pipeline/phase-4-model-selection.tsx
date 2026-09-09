'use client'

import { Fragment, useMemo, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  mpAcceptanceCriteriaAtom,
  mpCandidateJobIdAtom,
  mpCompareRunIdsAtom,
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpSelectedMetricsAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
  ALGORITHM_LABELS,
  type Algorithm,
} from '@/store/model-pipeline'
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
import { useCandidateJob } from '@/hooks/model/use-candidate-job'
import { useCandidatePredictions } from '@/hooks/model/use-candidate-predictions'
import { useDraftRuns } from '@/hooks/model/use-draft-runs'
import { useDraftSelection } from '@/hooks/model/use-draft-selection'
import { cvScoringPhaseOf } from '@/hooks/model/use-draft-run-evaluation'
import {
  METRIC_KEYS,
  METRIC_META,
  toggleMetricSelection,
  type MetricKey,
} from '@/lib/model-metrics'
import {
  METRIC_SOURCE_LABELS,
  holdoutGroupMissingRateText,
  metricValueOf,
  sourcedMetricsOf,
  type CvFoldEstimate,
  type SourcedMetrics,
} from '@/lib/metric-source'
import {
  DEFAULT_RANK_METRIC,
  RANK_DIRECTION,
  rankCandidates,
  rankingSummaryText,
  type RankMetricKey,
  type UnrankedReason,
} from '@/lib/metric-ranking'
import { classifyHyperparams } from '@/lib/run-params'
// MODEL-FLOW-021-T01. These four moved out of this file unchanged so Step 3's
// own run comparison obeys the SAME comparability rules — see the module's
// own doc comment for why a second derivation would be a defect.
import { comparabilityNote, groupByTarget } from '@/lib/run-comparison'
import {
  modeARows,
  modeAHasValidationSeries,
  modeAMetricLabel,
  modeBMarks,
  renderModeFor,
} from '@/lib/run-selection'
import {
  modelDraftCandidateJobService,
  modelDraftService,
} from '@/services/model-draft'
import type {
  CandidateResult,
  ModelCandidateJob,
  ModelTrainingRunListItem,
  RunPredictionsBatchItem,
} from '@/services/model-draft'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { CandidateBaseChart } from './model-selection/candidate-base-chart'
import { CandidateOverlayChart } from './model-selection/candidate-overlay-chart'

interface Props {
  nav: UsePipelineNavResult
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

/** A metrics blob's numeric field, or null — same narrowing every other
 *  reader of this untyped Json column already does (RunParamsPanel's own
 *  `rmse` field, `lib/run-comparison.ts`'s `numberField`). Never NaN, never
 *  a string coerced into a number. */
function numField(
  metrics: Record<string, unknown> | null,
  key: string,
): number | null {
  const v = metrics?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * MODEL-FLOW-019-T08 part 4. Maps a draft run row onto the SAME
 * `CandidateResult` shape the job path already produces, so both render
 * through `CandidateTable`/`CandidateOverlayChart` and never drift.
 *
 * Every field here is either read straight off `run` (most of them — the
 * run row and the job's own candidate shape share `predictionsKey`,
 * `cvFoldsKey`, `scoringContainerId`, `lossHistoryKey` exactly) or narrowed
 * from the same untyped `metrics` Json every other reader narrows
 * (`metrics`/`trainMetrics`, the `train_*` convention MODEL-FLOW-013-T04
 * established). `lossHistory` is the one honest exception: the run row
 * never carries the PARSED series (only the job response embeds it
 * inline), so it is `null` here rather than a fabricated shape — T08's own
 * rule against inventing a value a run row has no source for.
 */
function candidateFromRun(run: ModelTrainingRunListItem): CandidateResult {
  const cvPhase = cvScoringPhaseOf(run)
  const hasHoldout = typeof run.holdoutMetrics?.rmse === 'number'
  return {
    algorithm: run.algorithm,
    status: run.status,
    runId: run.id,
    phase: 1,
    hyperparameters: run.hyperparameters,
    failureReason: run.failureReason,
    metrics: run.metrics
      ? {
          r2: numField(run.metrics, 'r2'),
          rmse: numField(run.metrics, 'rmse'),
          mae: numField(run.metrics, 'mae'),
        }
      : null,
    trainMetrics: run.metrics
      ? {
          r2: numField(run.metrics, 'train_r2'),
          rmse: numField(run.metrics, 'train_rmse'),
          mae: numField(run.metrics, 'train_mae'),
        }
      : null,
    lossHistoryKey: run.lossHistoryKey,
    lossHistory: null,
    predictionsKey: run.predictionsKey,
    cvFoldsKey: run.cvFoldsKey,
    scoringContainerId: run.scoringContainerId,
    sourcedMetrics: sourcedMetricsOf(run),
    holdoutAbsence: hasHoldout
      ? null
      : cvPhase === 'awaiting-scoring' || cvPhase === 'scoring'
        ? 'not-scored-yet'
        : 'not-recorded',
  }
}

const STATUS_META: Record<
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

/**
 * MODEL-FLOW-013-T07. Two honest render modes — never one faked into the
 * other. Mode A (a real per-iteration curve) plots `train`, and only when
 * present a second line explicitly labelled "Test split" (never
 * "validation" — MODEL-FLOW-004's own finding on this exact misnomer).
 * Mode B (no curve exists) shows train/test RMSE as two paired marks, never
 * connected by a line — a two-point line is visually indistinguishable
 * from a real curve to a reader.
 */
function CandidateChart({ candidate }: { candidate: CandidateResult }) {
  return renderModeFor(candidate) === 'A' ? (
    <CandidateChartModeA candidate={candidate} />
  ) : (
    <CandidateChartModeB candidate={candidate} />
  )
}

function CandidateChartModeA({ candidate }: { candidate: CandidateResult }) {
  const rows = modeARows(candidate)
  const hasValidation = modeAHasValidationSeries(candidate)
  const metricLabel = modeAMetricLabel(candidate)
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium text-muted-foreground">
        {metricLabel} over iterations
      </p>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Train
        </span>
        {hasValidation && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Test split
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart
          data={rows}
          margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
        >
          <XAxis
            dataKey="iteration"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={32}
            label={{
              value: metricLabel,
              angle: -90,
              position: 'insideLeft',
              fontSize: 10,
            }}
          />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            formatter={(value: unknown, name: unknown) => [
              typeof value === 'number' ? value.toFixed(4) : String(value),
              name === 'validation' ? 'Test split' : 'Train',
            ]}
          />
          <Line
            type="monotone"
            dataKey="train"
            stroke="var(--primary)"
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
          {hasValidation && (
            <Line
              type="monotone"
              dataKey="validation"
              stroke="#0ea5e9"
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * MODEL-FLOW-013-T07's own Mode B: this algorithm's run produced no
 * per-iteration `lossHistory`, so there is no curve to plot — a disabled
 * placeholder (dashed border, muted background, no interactivity) showing
 * the two RMSE marks `modeBMarks` already derives, explicitly NOT joined by
 * a line (a two-point line reads as a real curve to a viewer, the exact
 * mistake this mode exists to avoid).
 */
function CandidateChartModeB({ candidate }: { candidate: CandidateResult }) {
  const marks = modeBMarks(candidate)
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium text-muted-foreground">
        No loss curve for this algorithm
      </p>
      <p className="text-[10px] text-muted-foreground">
        No iteration-by-iteration curve for this algorithm — train/test RMSE
        shown as marks instead.
      </p>
      <div className="flex h-[120px] items-center justify-center gap-8 rounded-md border border-dashed border-border bg-muted/20">
        {marks.map(mark => (
          <div key={mark.label} className="flex flex-col items-center gap-1">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                mark.label === 'Train' ? 'bg-primary' : 'bg-sky-500',
              )}
            />
            <span className="text-[10px] text-muted-foreground">
              {mark.label}
            </span>
            <span className="font-mono text-xs tabular-nums text-foreground">
              {mark.rmse === null ? '—' : mark.rmse.toFixed(3)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
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
const UNRANKED_LABELS: Record<UnrankedReason, string> = {
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
function isRankMetricKey(key: MetricKey): key is RankMetricKey {
  return key in RANK_DIRECTION
}

/** MODEL-FLOW-019-T10. Fixed column order so `sd` renders beside `rmse` —
 *  `residual_SD <= RMSE` always, and the gap between them IS the model's
 *  bias, readable by eye only when the two are adjacent rather than
 *  separated by `mae`. Independent of pick order in `mpSelectedMetricsAtom`. */
const STEP4_COLUMN_ORDER: readonly MetricKey[] = ['r2', 'rmse', 'sd', 'mae']

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
const VALIDATE_COLUMN_CLASS = 'border-l border-primary/30 bg-primary/5'

function MetricSourceCell({
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
}

/** One SD figure — or its reason — in the column its own `source` names.
 *  Never called for the OTHER column: that one renders a plain dash at the
 *  call site, the same "nothing to show, nothing to explain" treatment a
 *  non-CV run's holdout cell already gets. */
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

/** One picker, one atom — a second copy with its own state is how two
 *  surfaces start disagreeing about what a metric is called. */
function MetricsPicker() {
  const [selectedMetrics, setSelectedMetrics] = useAtom(mpSelectedMetricsAtom)
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Metrics
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-full">
          <DropdownMenuLabel>Show metrics</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {METRIC_KEYS.map(key => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={selectedMetrics.includes(key)}
              disabled={
                selectedMetrics.length === 1 && selectedMetrics.includes(key)
              }
              onCheckedChange={on =>
                setSelectedMetrics(prev => toggleMetricSelection(prev, key, on))
              }
            >
              {METRIC_META[key].label} — {METRIC_META[key].hint}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
function CandidateTable({
  candidates,
  resolvedRunId,
  selecting,
  onSelect,
  selectedMetrics,
  sortMetric,
  onSortMetric,
  byRunId,
  predictionsLoading,
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
  predictionsLoading: boolean
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
              const sdCell = residualSdOf(
                candidate,
                candidate.runId ? byRunId.get(candidate.runId) : undefined,
                predictionsLoading,
              )
              const comparisonFigures: ComparisonFigures = {
                sourcedMetrics: candidate.sourcedMetrics,
                residualSd: sdCell,
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
                            {sdCell.source === 'test-split' ? (
                              <SdCellBody cell={sdCell} />
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>
                          <TableCell
                            className={cn('text-right', VALIDATE_COLUMN_CLASS)}
                          >
                            {sdCell.source === 'holdout' ? (
                              <SdCellBody cell={sdCell} />
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground">
                                —
                              </span>
                            )}
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
                          <CandidateBaseChart
                            runId={candidate.runId}
                            item={byRunId.get(candidate.runId)}
                            loading={predictionsLoading}
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

const RANK_ARIA: Record<RankMetricKey, 'ascending' | 'descending'> = {
  rmse: 'ascending',
  mae: 'ascending',
  r2: 'descending',
}

function resolvedRunIdFor(job: ModelCandidateJob): string | null {
  return job.selectedRunId ?? job.bestRunId
}

function CandidateComparison({
  draftId,
  jobId,
}: {
  draftId: string
  jobId: string
}) {
  const { job, loading, error, refetch } = useCandidateJob(draftId, jobId)
  const [selecting, setSelecting] = useState(false)
  const [selectError, setSelectError] = useState<string | null>(null)
  // MODEL-FLOW-019-T04. `mpSelectedMetricsAtom` — the SAME state Step 5's
  // own picker reads and writes, per this feature's resolved decision: a
  // second picker with its own state is how two surfaces start disagreeing
  // about what a metric is called. `sortMetric` is local — an ephemeral
  // view preference for this screen, not a value worth persisting past it.
  const [selectedMetrics, setSelectedMetrics] = useAtom(mpSelectedMetricsAtom)
  const [sortMetric, setSortMetric] =
    useState<RankMetricKey>(DEFAULT_RANK_METRIC)
  // MODEL-FLOW-019-T07. Same shared-atom pattern as `mpSelectedMetricsAtom`
  // above — read independently at each surface that renders CandidateTable.
  const acceptanceCriteria = useAtomValue(mpAcceptanceCriteriaAtom)

  // MODEL-FLOW-017-T03. Every terminal candidate's own runId, in one batch
  // request — a candidate not yet SUCCEEDED (no runId) contributes nothing
  // to fetch, not an error (CandidateBaseChart's own `!runId` early return
  // covers it). `job?.candidates` is a fresh array reference per fetch, not
  // per render, since it comes straight off `useCandidateJob`'s own state.
  const candidateRunIds = useMemo(
    () =>
      job?.candidates
        .map(c => c.runId)
        .filter((id): id is string => id !== null) ?? [],
    [job],
  )
  const { byRunId, loading: predictionsLoading } = useCandidatePredictions(
    draftId,
    candidateRunIds,
    'test',
  )
  // MODEL-FLOW-019-T20. A SECOND fetch, not a widened first one: the two
  // populations come from different object keys per run and either can be
  // absent on its own (a non-CV run that has never been scored has no
  // holdout series; a CV run has no test split at all). Fetching them
  // separately is what lets each chart state its own source and render its
  // own absence — merging them into one map would need a per-point tag to
  // stay honest, which is the conflation this feature exists to prevent.
  const { byRunId: holdoutByRunId } = useCandidatePredictions(
    draftId,
    candidateRunIds,
    'holdout',
  )

  // MODEL-FLOW-019-T08 part 3. Step 3's own compare checkboxes sit on draft
  // runs, and a job-owned run IS a draft run, so a ticked set narrows this
  // path too — implemented HERE, independently of the standalone path
  // below, so the two cannot resolve "empty means all" differently.
  // Intersected against this job's OWN candidates (not the raw atom) so a
  // stale id left over from a different draft/job cannot empty this table
  // out from under the user.
  const compareRunIds = useAtomValue(mpCompareRunIdsAtom)
  const activeCompareIds = useMemo(
    () =>
      new Set([...compareRunIds].filter(id => candidateRunIds.includes(id))),
    [compareRunIds, candidateRunIds],
  )

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-56 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (error || !job) {
    return (
      <EmptyPanel>
        Could not load the candidate comparison{error ? ` — ${error}` : ''}.
      </EmptyPanel>
    )
  }

  const nonTerminal = job.status === 'QUEUED' || job.status === 'RUNNING'
  if (nonTerminal) {
    return (
      <EmptyPanel>
        Sweep is still running — {job.completedRuns} of {job.totalRuns}{' '}
        candidates finished.
      </EmptyPanel>
    )
  }

  const resolvedRunId = resolvedRunIdFor(job)

  // Empty means every candidate — the same rule Step 3's own footer states
  // in words. `resolvedRunId` above stays computed off the FULL job
  // (selection is server-side draft state, not a view of the narrowed set).
  const visibleCandidates =
    activeCompareIds.size === 0
      ? job.candidates
      : job.candidates.filter(
          c => c.runId !== null && activeCompareIds.has(c.runId),
        )

  const handleSelect = async (runId: string) => {
    setSelecting(true)
    setSelectError(null)
    try {
      await modelDraftCandidateJobService.select(draftId, jobId, runId)
      refetch()
    } catch (err) {
      setSelectError(
        err instanceof Error ? err.message : 'Could not record that selection.',
      )
    } finally {
      setSelecting(false)
    }
  }

  return (
    <div className="space-y-4">
      {job.status === 'FAILED' && (
        <EmptyPanel>
          Sweep failed{job.failureReason ? ` — ${job.failureReason}` : '.'}{' '}
          Candidates that did finish are still shown below.
        </EmptyPanel>
      )}
      {selectError && <p className="text-xs text-red-500">{selectError}</p>}
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Metrics
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-full">
            <DropdownMenuLabel>Show metrics</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {METRIC_KEYS.map(key => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={selectedMetrics.includes(key)}
                disabled={
                  selectedMetrics.length === 1 && selectedMetrics.includes(key)
                }
                onCheckedChange={on =>
                  setSelectedMetrics(prev =>
                    toggleMetricSelection(prev, key, on),
                  )
                }
              >
                {METRIC_META[key].label} — {METRIC_META[key].hint}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CandidateGroups
        candidates={visibleCandidates}
        resolvedRunId={resolvedRunId}
        selecting={selecting}
        onSelect={runId => void handleSelect(runId)}
        byRunId={byRunId}
        holdoutByRunId={holdoutByRunId}
        predictionsLoading={predictionsLoading}
        selectedMetrics={selectedMetrics}
        sortMetric={sortMetric}
        onSortMetric={setSortMetric}
        criteria={acceptanceCriteria}
      />
    </div>
  )
}

/**
 * MODEL-FLOW-013-T11. A SWEEP_THEN_TUNE job's candidates carry a `phase` —
 * 1 (the sweep) or 2 (tuning phase 1's winner, appended server-side once
 * phase 1 exhausts). Grouped into two headed sections ONLY once a phase-2
 * group actually exists; an ALGORITHM_SWEEP job (no `phase: 2` candidate
 * ever) or a SWEEP_THEN_TUNE job still mid-phase-1 renders the exact same
 * flat, unheaded grid it always has — no empty "Tuning" header.
 */
function CandidateGroups({
  candidates,
  resolvedRunId,
  selecting,
  onSelect,
  byRunId,
  holdoutByRunId,
  predictionsLoading,
  selectedMetrics,
  sortMetric,
  onSortMetric,
  criteria,
}: {
  candidates: CandidateResult[]
  resolvedRunId: string | null
  selecting: boolean
  onSelect: (runId: string) => void
  byRunId: Map<string, RunPredictionsBatchItem>
  /** MODEL-FLOW-019-T20. The same candidates' HOLDOUT series, fetched
   *  separately — empty for a candidate never scored against one. */
  holdoutByRunId: Map<string, RunPredictionsBatchItem>
  predictionsLoading: boolean
  selectedMetrics: MetricKey[]
  sortMetric: RankMetricKey
  onSortMetric: (key: RankMetricKey) => void
  criteria?: AcceptanceCriterion[]
}) {
  const phase1 = candidates.filter(c => c.phase !== 2)
  const phase2 = candidates.filter(c => c.phase === 2)
  const tunedAlgorithm = phase2[0]?.algorithm
  const tunedLabel = tunedAlgorithm
    ? (ALGORITHM_LABELS[tunedAlgorithm as Algorithm] ?? tunedAlgorithm)
    : null

  // MODEL-FLOW-019-T04. Sorting stays WITHIN one phase group (openDecisions
  // item 1, resolved 2026-09-05) — a tuning phase's candidates share one
  // algorithm and are directly comparable in a way the sweep phase's are
  // not (MODEL-FLOW-013-T11), and ranking them against each other would
  // lose that. Each group gets its own `CandidateTable` call, its own
  // ranking, its own summary sentence.
  const section = (group: CandidateResult[]) => (
    <div className="space-y-4">
      <CandidateOverlayChart
        candidates={group}
        byRunId={byRunId}
        population="test-split"
      />
      {/* MODEL-FLOW-019-T20. Beside the test-split overlay, never merged
          into it — the two windows are genuinely different data (the
          holdout is raw rows split off at BRONZE that no fit ever saw)
          and mistaking one for the other is what produced T19's report.
          Renders nothing at all when no candidate here has been scored
          against a holdout, which is its own honest state: the chart
          cannot claim an absence it has not checked. */}
      <CandidateOverlayChart
        candidates={group}
        byRunId={holdoutByRunId}
        population="holdout"
        note={holdoutGroupMissingRateText(group.map(c => c.sourcedMetrics))}
      />
      <CandidateTable
        candidates={group}
        resolvedRunId={resolvedRunId}
        selecting={selecting}
        onSelect={onSelect}
        selectedMetrics={selectedMetrics}
        sortMetric={sortMetric}
        onSortMetric={onSortMetric}
        byRunId={byRunId}
        predictionsLoading={predictionsLoading}
        criteria={criteria}
      />
    </div>
  )

  if (phase2.length === 0) return section(phase1)

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium text-muted-foreground">Sweep</p>
      {section(phase1)}
      <p className="text-xs font-medium text-muted-foreground">
        Tuning {tunedLabel}
      </p>
      {section(phase2)}
    </div>
  )
}

/**
 * DELETED by MODEL-FLOW-019-T08 part 4 ("one layout, and the overlay chart
 * everywhere"), which reversed MODEL-FLOW-016-T11/MODEL-FLOW-018-T04's own
 * decision that a single selectable run needed its own pass-through
 * component. A 1-row `CandidateTable` (via `StandaloneComparison`, below)
 * now covers this case too: MODEL-FLOW-013's "a single run must not stall"
 * acceptance criterion is honoured by a table that asks the user to choose
 * nothing, not by a second renderer. `SingleRunSummary`'s own facts survive
 * elsewhere rather than being lost: the algorithm/RMSE/CV-mean±std numbers
 * this component printed as prose are the SAME `sourcedMetricsOf` figures
 * `CandidateTable`'s cells already render for any run; the two CV-phase
 * sentences ("Scoring is running…", "an estimate of the configuration…")
 * live on in `StandaloneComparison`'s own `noteFor`; and the "score it
 * against the holdout" call-to-action is now a real button
 * (`StandaloneComparison`'s `actionFor`) rather than only prose.
 */

function formatRunTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StandaloneComparison({
  draftId,
  runs,
  selectedRunId,
  refetchSelection,
}: {
  draftId: string
  runs: ModelTrainingRunListItem[]
  selectedRunId: string | null
  refetchSelection: () => void
}) {
  const [selectingRunId, setSelectingRunId] = useState<string | null>(null)
  const [selectError, setSelectError] = useState<string | null>(null)
  const selectedMetrics = useAtomValue(mpSelectedMetricsAtom)
  const acceptanceCriteria = useAtomValue(mpAcceptanceCriteriaAtom)
  const [sortMetric, setSortMetric] =
    useState<RankMetricKey>(DEFAULT_RANK_METRIC)
  // Same raw-setter pattern StandaloneRunRow used, and for the same reason:
  // this component sits below `Phase4ModelSelection`'s `nav` prop and
  // threading it through two intermediates that never use it is the churn
  // that pattern avoids.
  const setCurrentStep = useSetAtom(mpCurrentStepAtom)
  const setHighestUnlocked = useSetAtom(mpHighestUnlockedAtom)

  const byId = useMemo(() => new Map(runs.map(run => [run.id, run])), [runs])
  // Only SUCCEEDED runs have predictions to fetch; the rest contribute
  // nothing, not an error (CandidateBaseChart's own `!runId` early return).
  const runIds = useMemo(
    () => runs.filter(run => run.status === 'SUCCEEDED').map(run => run.id),
    [runs],
  )
  const { byRunId, loading: predictionsLoading } = useCandidatePredictions(
    draftId,
    runIds,
    'test',
  )
  // MODEL-FLOW-019-T20. The standalone path's own holdout fetch — same
  // reasoning as the job path's (see there); duplicated as a CALL, not as
  // a rule, since both go through the one `useCandidatePredictions`.
  const { byRunId: holdoutByRunId } = useCandidatePredictions(
    draftId,
    runIds,
    'holdout',
  )

  const handleSelect = async (runId: string) => {
    setSelectingRunId(runId)
    setSelectError(null)
    try {
      await modelDraftService.selectRun(draftId, runId)
      refetchSelection()
    } catch (err) {
      setSelectError(
        err instanceof Error ? err.message : 'Could not record that selection.',
      )
    } finally {
      setSelectingRunId(null)
    }
  }

  const groups = groupByTarget(runs)
  const multiTarget = groups.length > 1

  // What the card layout carried and a table cell has no column for. The
  // TIMESTAMP is not decoration here: two runs of the same algorithm on the
  // same target are otherwise indistinguishable rows, which the card's own
  // identity line prevented.
  const noteFor = (groupRuns: ModelTrainingRunListItem[]) =>
    function NoteFor(runId: string) {
      const run = byId.get(runId)
      if (!run) return null
      const note = comparabilityNote(run, groupRuns)
      const cvPhase = cvScoringPhaseOf(run)
      const estimate =
        cvPhase === 'scoring'
          ? 'Holdout scoring is running — it refits nothing, it only scores the model already trained.'
          : cvPhase === 'awaiting-scoring'
            ? "Fold mean — an estimate of the configuration, not the shipped model's own score."
            : null
      return (
        <div className="space-y-0.5 pt-0.5">
          <p className="text-[10px] text-muted-foreground">
            {formatRunTimestamp(run.createdAt)}
          </p>
          {estimate && (
            <p className="text-[10px] leading-snug text-muted-foreground">
              {estimate}
            </p>
          )}
          {note && (
            <p className="text-[10px] leading-snug text-muted-foreground">
              {note}
            </p>
          )}
        </div>
      )
    }

  const actionFor = (runId: string) => {
    const run = byId.get(runId)
    if (!run || run.id !== selectedRunId) return null
    if (cvScoringPhaseOf(run) !== 'awaiting-scoring') return null
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 cursor-pointer gap-1 px-2 text-xs"
        title="Score this model against the dataset's validation holdout."
        onClick={() => {
          setHighestUnlocked(prev => Math.max(prev, 5))
          setCurrentStep(5)
        }}
      >
        Score
        <ArrowRight className="h-3 w-3" />
      </Button>
    )
  }

  return (
    <div className="space-y-4">
      {selectError && <p className="text-xs text-red-500">{selectError}</p>}
      <MetricsPicker />
      {groups.map(([targetY, groupRuns]) => {
        const groupCandidates = groupRuns.map(candidateFromRun)
        return (
          <div key={targetY} className="space-y-4">
            {multiTarget && (
              <p className="text-xs font-medium text-muted-foreground">
                y = {targetY}
              </p>
            )}
            {/* MODEL-FLOW-019-T08 part 4. The overlay chart the job path
                already gets (`CandidateGroups`' own `section()`), now on
                every path — including a single-run group, which renders one
                prediction series against actual rather than no chart at
                all. */}
            <CandidateOverlayChart
              candidates={groupCandidates}
              byRunId={byRunId}
              population="test-split"
            />
            {/* MODEL-FLOW-019-T20. The holdout counterpart, same layout,
                beside rather than merged — see the job path's own note. */}
            <CandidateOverlayChart
              candidates={groupCandidates}
              byRunId={holdoutByRunId}
              population="holdout"
              note={holdoutGroupMissingRateText(
                groupCandidates.map(c => c.sourcedMetrics),
              )}
            />
            <CandidateTable
              candidates={groupCandidates}
              resolvedRunId={selectedRunId}
              selecting={selectingRunId !== null}
              onSelect={runId => void handleSelect(runId)}
              selectedMetrics={selectedMetrics}
              sortMetric={sortMetric}
              onSortMetric={setSortMetric}
              byRunId={byRunId}
              predictionsLoading={predictionsLoading}
              rowNote={noteFor(groupRuns)}
              rowAction={actionFor}
              chartMode="predictions-only"
              criteria={acceptanceCriteria}
            />
          </div>
        )
      })}
    </div>
  )
}

/**
 * MODEL-FLOW-018-T04, reversed by MODEL-FLOW-019-T08 part 4 ("one layout
 * for every training shape"): every selectable-run count, including one,
 * now renders through this same comparison table + overlay chart — see
 * the deleted `SingleRunSummary`'s own doc comment for where its facts
 * went. Fetches the run list ONCE here and passes it down, rather than
 * each child fetching its own copy.
 */
function StandaloneSelection({ draftId }: { draftId: string }) {
  const { runs, loading, error } = useDraftRuns(draftId)
  const { selectedRunId, refetch: refetchSelection } =
    useDraftSelection(draftId)
  // MODEL-FLOW-019-T08 part 3. Empty means every run — the same rule
  // Step 3's own footer states in words. Intersected against this draft's
  // OWN run list (not the raw atom) so a stale id left over from a
  // different draft cannot empty this table out from under the user.
  const compareRunIds = useAtomValue(mpCompareRunIdsAtom)
  const activeCompareIds = useMemo(
    () => new Set([...compareRunIds].filter(id => runs.some(r => r.id === id))),
    [compareRunIds, runs],
  )

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (error) {
    return <EmptyPanel>Could not load training runs — {error}</EmptyPanel>
  }

  const visibleRuns =
    activeCompareIds.size === 0
      ? runs
      : runs.filter(run => activeCompareIds.has(run.id))

  return (
    <StandaloneComparison
      draftId={draftId}
      runs={visibleRuns}
      selectedRunId={selectedRunId}
      refetchSelection={refetchSelection}
    />
  )
}

/**
 * MODEL-FLOW-013, extended by MODEL-FLOW-018-T04 and MODEL-FLOW-019-T08.
 * Compares each candidate an algorithm sweep trained (Step 3's "Find Best
 * Model") and lets the user pick which one carries forward, or accept the
 * metric's own answer. `mpCandidateJobIdAtom` being null means there is no
 * CURRENT sweep to show via that path — it does NOT mean there is nothing
 * to compare: a draft whose runs were launched one at a time (including
 * every CV run, which can never belong to a sweep) now gets its own
 * comparison (`StandaloneSelection`), sourced from the draft's run list
 * rather than a job's candidates array. T08 part 4 made this ONE layout for
 * every count, including one selectable run — MODEL-FLOW-013's own
 * acceptance criterion ("a single run must not stall") is now honoured by a
 * 1-row table asking the user to choose nothing, not by a second renderer.
 */
export function Phase4ModelSelection({ nav }: Props) {
  const draftId = useAtomValue(mpServerDraftIdAtom)
  const candidateJobId = useAtomValue(mpCandidateJobIdAtom)
  const trainingResult = useAtomValue(mpTrainingResultAtom)

  if (!trainingResult) {
    return (
      <div className="space-y-4">
        <EmptyPanel>
          No training run yet — start training in Step 3 to see it here.
        </EmptyPanel>
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={() => nav.goTo(3)}>
            Go to Training Configuration
          </Button>
        </div>
      </div>
    )
  }

  if (!candidateJobId) {
    if (!draftId) {
      return <EmptyPanel>Model draft isn&apos;t ready yet.</EmptyPanel>
    }
    return <StandaloneSelection draftId={draftId} />
  }

  if (!draftId) {
    return <EmptyPanel>Model draft isn&apos;t ready yet.</EmptyPanel>
  }

  return <CandidateComparison draftId={draftId} jobId={candidateJobId} />
}
