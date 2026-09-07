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
  mpCandidateJobIdAtom,
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpSelectedMetricsAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
  ALGORITHM_LABELS,
  type Algorithm,
  type DraftTrainingResult,
} from '@/store/model-pipeline'
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
  metricValueOf,
  rmseOf,
  sourcedMetricsOf,
  type MetricSource,
  type SourcedMetrics,
} from '@/lib/metric-source'
import {
  DEFAULT_RANK_METRIC,
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
  if (renderModeFor(candidate) === 'A') {
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
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Test
              split
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
              formatter={(value: unknown) =>
                typeof value === 'number' ? value.toFixed(4) : String(value)
              }
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

  // Mode B — no real trajectory for this algorithm. Paired marks, no line.
  const marks = modeBMarks(candidate)
  const max = Math.max(0.0001, ...marks.map(m => m.rmse ?? 0))
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-medium text-muted-foreground">
        model performance — train vs. test RMSE
      </p>
      <p className="text-[10px] text-muted-foreground">
        No iteration-by-iteration curve for this algorithm — train vs. test
        RMSE, as two points.
      </p>
      <div className="flex items-end gap-4 pt-1">
        {marks.map(mark => (
          <div
            key={mark.label}
            className="flex flex-1 flex-col items-center gap-1"
          >
            <span className="font-mono text-xs tabular-nums text-foreground">
              {mark.rmse !== null ? mark.rmse.toFixed(3) : '—'}
            </span>
            <div className="flex h-16 w-6 items-end rounded-sm bg-muted/60">
              {mark.rmse !== null && (
                <div
                  className={cn(
                    'w-full rounded-sm',
                    mark.label === 'Train' ? 'bg-primary' : 'bg-sky-500',
                  )}
                  style={{ height: `${(mark.rmse / max) * 100}%` }}
                />
              )}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {mark.label}
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

/** MODEL-FLOW-019-T04. `sd` is computed only in Evaluation, over one run's
 *  own residual series (`pred.residualSd`) — no candidate-job source
 *  (`metrics`/`holdoutMetrics`/a CV fold aggregate) ever carries it, so
 *  every cell under it reads the same honest "not tracked here" rather than
 *  a blank, and its header is not a sort target (`RankMetricKey` excludes
 *  `sd` for the same reason — there is nothing to sort BY). */
const UNTRACKED_METRIC_KEYS: readonly MetricKey[] = ['sd']

function isRankMetricKey(key: MetricKey): key is RankMetricKey {
  return !UNTRACKED_METRIC_KEYS.includes(key)
}

/**
 * One metric's two source columns — never merged into one cell (finding 3;
 * MODEL-FLOW-019 AC10). `metric` is the tagged value ITSELF, read via
 * `metricValueOf`, so a cell literally cannot show a number without also
 * having the source it came from in hand.
 */
function MetricSourceCell({
  metric,
  metricKey,
  emptyReason,
}: {
  metric: SourcedMetrics | null
  metricKey: RankMetricKey
  /** Only meaningful when `metric` is null — the three-facts text AC11
   *  requires for an absent holdout figure. Undefined for the Test column,
   *  which has no such reason to report (a non-CV SUCCEEDED run always has
   *  a test-split figure; a CV or non-terminal row shows a plain dash,
   *  matching this table's pre-existing Test-column behaviour). */
  emptyReason?: string
}) {
  if (!metric) {
    return (
      <TableCell className="text-right">
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
  // MISSING RATE, ALWAYS shown beside a holdout figure (DS-LAKE-018-T05;
  // MODEL-FLOW-019 AC2) — a legacy run may have the score and not the
  // counts, which must read as "not recorded" rather than a fabricated 0%.
  const rateText =
    metric.source === 'holdout'
      ? metric.rowCount === null
        ? 'missing rate not recorded'
        : (() => {
            const dropped =
              (metric.droppedUnlabelled ?? 0) + (metric.droppedBadFeatures ?? 0)
            return `${((dropped / metric.rowCount) * 100).toFixed(1)}% missing (n=${metric.rowCount})`
          })()
      : null
  return (
    <TableCell className="text-right">
      <p className="font-mono text-xs tabular-nums text-foreground">
        {value === null ? '—' : value.toFixed(3)}
      </p>
      {rateText && (
        <p className="text-[9px] text-muted-foreground">{rateText}</p>
      )}
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
  // rank + algorithm + status + two columns per selected metric + actions —
  // the chart row spans every column so it reads as one panel, not a cell.
  const totalCols = 3 + selectedMetrics.length * 2 + 1

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
              {selectedMetrics.map(key => {
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
                        title="Computed only in Evaluation, over one run's own residuals — not tracked per candidate here."
                      >
                        {METRIC_META[key].label}
                      </span>
                    )}
                  </TableHead>
                )
              })}
              <TableHead rowSpan={2} className="align-bottom" />
            </TableRow>
            <TableRow>
              {selectedMetrics.map(key => (
                <Fragment key={key}>
                  <TableHead className="border-l text-right text-[10px] font-normal">
                    Test
                  </TableHead>
                  <TableHead className="text-right text-[10px] font-normal">
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
              // run's `metrics` carries no bare rmse/r2/mae). Rather than
              // show that estimate under the "Test" header — the exact
              // merge-two-sources-into-one-column mistake this feature
              // exists to prevent — the Test cell says plainly that the
              // question does not apply. Unreached by any real data today
              // (no candidate-job candidate can be CV — CreateCandidateJob's
              // own schema has no `nSplits` field), kept honest in case that
              // ever changes.
              const testIsCv = testMetric?.source === 'cv-fold-estimate'
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
                    {selectedMetrics.map(key =>
                      isRankMetricKey(key) ? (
                        <Fragment key={key}>
                          {testIsCv ? (
                            <TableCell className="border-l text-right">
                              <span className="text-[10px] text-muted-foreground italic">
                                N/A — cross-validation
                              </span>
                            </TableCell>
                          ) : (
                            <MetricSourceCell
                              metric={testMetric}
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
                          />
                        </Fragment>
                      ) : (
                        <Fragment key={key}>
                          <TableCell className="border-l text-right">
                            <span className="text-[10px] text-muted-foreground">
                              n/a
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-[10px] text-muted-foreground">
                              n/a
                            </span>
                          </TableCell>
                        </Fragment>
                      ),
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
                          <CandidateChart candidate={candidate} />
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
          <DropdownMenuContent align="end">
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
        candidates={job.candidates}
        resolvedRunId={resolvedRunId}
        selecting={selecting}
        onSelect={runId => void handleSelect(runId)}
        byRunId={byRunId}
        predictionsLoading={predictionsLoading}
        selectedMetrics={selectedMetrics}
        sortMetric={sortMetric}
        onSortMetric={setSortMetric}
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
  predictionsLoading,
  selectedMetrics,
  sortMetric,
  onSortMetric,
}: {
  candidates: CandidateResult[]
  resolvedRunId: string | null
  selecting: boolean
  onSelect: (runId: string) => void
  byRunId: Map<string, RunPredictionsBatchItem>
  predictionsLoading: boolean
  selectedMetrics: MetricKey[]
  sortMetric: RankMetricKey
  onSortMetric: (key: RankMetricKey) => void
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
      <CandidateOverlayChart candidates={group} byRunId={byRunId} />
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
 * The ORIGINAL pass-through (MODEL-FLOW-016-T11) — a draft with only one
 * selectable run must not stall on a comparison table (MODEL-FLOW-013's own
 * acceptance criterion, restated by MODEL-FLOW-018-T04). Sourced from
 * `mpTrainingResultAtom`, a client-side cache of the run that just finished
 * training in THIS session — not a wizard form value, so MODEL-FLOW-012 AC1
 * (no current-form value rendered as a past run's own) does not apply to it
 * the way it would to Step 3's own atoms.
 *
 * MODEL-FLOW-018-T06 (advisor-found gap, 2026-09-04): `cvScoringPhase` /
 * `holdoutRmse` are optional because `DraftTrainingResult` carries no
 * `predictionsKey`/`scoringContainerId` — only the caller with the FULL run
 * row (`StandaloneSelection`'s own `selectedRun`) can know them. `undefined`
 * means exactly what it always meant before this task: the just-trained-
 * this-session fallback path, where scoring cannot yet have happened by
 * construction (it is a separate, later, user-triggered phase reachable only
 * from a resolved run in Evaluation) — same render as before. Without this,
 * a round trip (Step 4 -> Evaluation -> score -> back to Step 4) left this
 * component telling the user to do what they had just done, beside the fold
 * mean instead of `StandaloneRunRow`'s own honest `Holdout RMSE` — the same
 * category error in the same file, from two components disagreeing about one
 * run.
 */
function SingleRunSummary({
  trainingResult,
  cvScoringPhase,
  holdoutRmse,
}: {
  trainingResult: DraftTrainingResult
  cvScoringPhase?: 'awaiting-scoring' | 'scoring' | 'scored'
  holdoutRmse?: number | null
}) {
  const algorithmLabel =
    ALGORITHM_LABELS[trainingResult.algorithm] ?? trainingResult.algorithm
  // Render mode is a property of the RUN (`cvFoldsKey`), never the algorithm
  // name (MODEL-FLOW-013-T05a's rule) — CV and Find Best Model are mutually
  // exclusive, so this pass-through is the only place a CV run's own
  // summary renders.
  const isCv = trainingResult.cvFoldsKey !== null
  const phase = cvScoringPhase ?? 'awaiting-scoring'
  const rmse = trainingResult.metrics?.rmse
  const rmseMean = trainingResult.metrics?.cv_rmse_mean
  const rmseStd = trainingResult.metrics?.cv_rmse_std
  const nSplits = trainingResult.metrics?.n_splits
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 px-4 py-3 ring-1 ring-emerald-500/20">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
        <div>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            {algorithmLabel} trained
          </p>
          <p className="text-xs text-muted-foreground">
            Only one candidate this run — nothing to compare. Continue to
            Evaluation.
            {!isCv && typeof rmse === 'number' && ` RMSE ${rmse.toFixed(3)}.`}
            {isCv &&
              phase === 'scored' &&
              ` Validate RMSE ${typeof holdoutRmse === 'number' ? holdoutRmse.toFixed(3) : '—'}.`}
            {isCv &&
              phase !== 'scored' &&
              typeof rmseMean === 'number' &&
              typeof rmseStd === 'number' &&
              ` RMSE ${rmseMean.toFixed(3)} ± ${rmseStd.toFixed(3)}` +
                (typeof nSplits === 'number'
                  ? ` across ${nSplits} folds`
                  : '') +
                '.'}
          </p>
          {/* Three numbers, three meanings, never merged: this is the fold
              mean — how much to trust the CONFIGURATION, not a score for
              the refit model that ships. That model's own honest number
              (`holdoutRmse`, above) only exists once Evaluation's separate
              holdout-scoring phase runs (MODEL-FLOW-016-T07) — this note
              drops once it has, matching `StandaloneRunRow`'s own rule. */}
          {isCv && phase !== 'scored' && (
            <p className="text-[11px] text-muted-foreground">
              {phase === 'scoring'
                ? 'Scoring against the holdout is running — this refits nothing, it only scores the model already trained.'
                : "Mean ± std across folds — an estimate of the configuration, not the shipped model's own score. Score it against the holdout in Evaluation."}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

const RUN_STATUS_META: Record<
  ModelTrainingRunListItem['status'],
  { icon: typeof Clock; className: string }
> = {
  QUEUED: { icon: Clock, className: 'text-muted-foreground' },
  RUNNING: { icon: Loader2, className: 'text-primary animate-spin' },
  SUCCEEDED: { icon: CheckCircle2, className: 'text-emerald-500' },
  FAILED: { icon: AlertTriangle, className: 'text-red-500' },
  // Same icon `STATUS_META` above already uses for CANCELED (this file's
  // own established convention for a candidate) — one icon per status,
  // not two, within this file.
  CANCELED: { icon: AlertTriangle, className: 'text-muted-foreground' },
}

function formatRunTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * MODEL-FLOW-018-T04. A standalone run's own row — a SEPARATE renderer from
 * `CandidateRow` above, deliberately: the task's own instruction is that
 * both shapes coexist and neither is flattened into the other's renderer.
 * `CandidateResult` and `ModelTrainingRunListItem` differ in exactly the
 * fields that matter here (no `phase`, a real `candidateJobId`, `cvFoldsKey`
 * for the CV-aware metric read below) — coercing one shape into the other's
 * component would either drop those fields or fake them.
 *
 * ROWS ARE NOT SORTED BY METRIC. `comparabilityNote` (MODEL-FLOW-018-T05,
 * computed by the caller and passed in) is how a differing dataset/feature-
 * spec/split shape is surfaced instead — sorting by RMSE would risk the
 * exact category error grouping-by-target exists to catch (two different
 * targets' RMSEs in one ordered column), so rows stay in the run list's own
 * server order (most-recent-first), same as RunParamsPanel.
 *
 * DISABLE REASONS ARE THE FIRST TWO OF MODEL-FLOW-018-T03's THREE — a
 * non-terminal run, and a FAILED/CANCELED one. The third (the run's own
 * candidate job still live) is not reproduced here: this branch is only
 * reached when `mpCandidateJobIdAtom` is null, i.e. there is no CURRENTLY
 * tracked live job to compare a run's `candidateJobId` against client-side.
 * `selectDraftRunService` still refuses it server-side regardless (the
 * authority for that check), and the refusal surfaces through `selectError`
 * below like any other refusal.
 */
function StandaloneRunRow({
  run,
  isSelected,
  selecting,
  comparabilityNote,
  onSelect,
}: {
  run: ModelTrainingRunListItem
  isSelected: boolean
  selecting: boolean
  comparabilityNote: string | null
  onSelect: () => void
}) {
  const algorithmLabel =
    ALGORITHM_LABELS[run.algorithm as Algorithm] ?? run.algorithm
  const status = RUN_STATUS_META[run.status]
  const StatusIcon = status.icon
  const nonTerminal = run.status === 'QUEUED' || run.status === 'RUNNING'
  const runFailed = run.status === 'FAILED' || run.status === 'CANCELED'
  const selectDisabledReason = nonTerminal
    ? 'Available once this run finishes.'
    : runFailed
      ? "This run didn't succeed — nothing to carry forward."
      : null

  // MODEL-FLOW-018-T06, per finding 6. Keyed off `cvFoldsKey`/
  // `cvScoringPhaseOf` (MODEL-FLOW-016-T11's own signals), never
  // `algorithm` — a membership list in the client is a second source of
  // truth that drifts, and it drifts toward showing an empty cell rather
  // than an honest one (MODEL-FLOW-013-T05a's rule). MODEL-FLOW-019-T02:
  // the row is passed whole now — that derivation reads only
  // `cvFoldsKey`/`predictionsKey`/`scoringContainerId`, so the hand-built
  // `DraftRunSummary` literal this used to construct carried nothing the
  // row itself does not.
  const cvPhase = cvScoringPhaseOf(run)

  // Three DIFFERENT quantities behind one column position, never blended:
  // a non-CV run's own test-split score; a CV run's fold-mean ESTIMATE of
  // the configuration, pre-scoring; a scored CV run's refit holdout score —
  // the shipped model's OWN number, never `metrics.cv_rmse_mean` (the same
  // category error MODEL-FLOW-016's finding 3 already caught once in this
  // wizard's Evaluation step). A missing metric renders as an em dash,
  // never 0 and never a value computed client-side.
  //
  // MODEL-FLOW-019-T02: WHICH of the three this row shows is unchanged, but
  // the value now comes from a tagged entry carrying its own source, so the
  // number and the label beneath it cannot be sourced from different
  // places. The phase picks the source; `sourcedMetricsOf` decides whether
  // that source has a figure at all. Deliberately NOT `headlineMetricOf` —
  // that prefers a holdout figure wherever one exists, which for an
  // ordinary run would silently relabel this shipped column.
  const sourced = sourcedMetricsOf(run)
  const shownSource: MetricSource =
    cvPhase === 'scored'
      ? 'holdout'
      : cvPhase === 'not-cv'
        ? 'test-split'
        : 'cv-fold-estimate'
  const shown = sourced.find(m => m.source === shownSource) ?? null
  const shownRmse = shown ? rmseOf(shown) : null
  const shownSpread =
    shown?.source === 'cv-fold-estimate' ? shown.std.rmse : null
  const metricValue =
    shownRmse === null
      ? '—'
      : `${shownRmse.toFixed(3)}${
          shownSpread !== null ? ` ± ${shownSpread.toFixed(3)}` : ''
        }`
  const metricLabel = `${METRIC_SOURCE_LABELS[shownSource]} RMSE`

  // MODEL-FLOW-018-T03's own pattern (RunParamsPanel's footer CTA): raw
  // setters, not `nav.goTo()` — `StandaloneRunRow` sits three components
  // below `Phase4ModelSelection`'s own `nav` prop, and threading it through
  // two intermediate components that never use it themselves just to reach
  // this one leaf branch is the exact prop churn that pattern exists to
  // avoid. Gated on `isSelected`: `nav`-equivalent navigation to Evaluation
  // resolves whichever run `ModelDraft.selectedRunId` (or its fallback
  // chain) currently names — offering this action on a NON-selected row
  // would silently land on a DIFFERENT run's Evaluation, the exact
  // "whichever ran last" failure this whole feature exists to replace.
  const setCurrentStep = useSetAtom(mpCurrentStepAtom)
  const setHighestUnlocked = useSetAtom(mpHighestUnlockedAtom)

  return (
    <div
      className={cn(
        'space-y-3 rounded-xl border p-4',
        isSelected
          ? 'border-primary ring-1 ring-primary/40'
          : 'border-border/60',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <StatusIcon
              className={cn('h-3.5 w-3.5 shrink-0', status.className)}
            />
            <span className="text-sm font-medium text-foreground">
              {algorithmLabel}
            </span>
            {isSelected && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
                Carrying forward
              </Badge>
            )}
          </div>
          <p className="truncate text-[10px] text-muted-foreground">
            y = {run.targetY} · {formatRunTimestamp(run.createdAt)}
          </p>
          {run.failureReason && (
            <p className="text-[11px] text-red-500">{run.failureReason}</p>
          )}
        </div>
        {run.status === 'SUCCEEDED' && (
          <div className="shrink-0 text-right">
            <p className="font-mono text-sm tabular-nums text-foreground">
              {metricValue}
            </p>
            <p className="text-[10px] text-muted-foreground">{metricLabel}</p>
          </div>
        )}
      </div>

      {comparabilityNote && (
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          {comparabilityNote}
        </p>
      )}

      {/* MODEL-FLOW-018-T06. The configuration's own estimate is not the
          shipped model's score — say so, same fact SingleRunSummary already
          states for the pre-comparison pass-through, worded to match. */}
      {(cvPhase === 'awaiting-scoring' || cvPhase === 'scoring') && (
        <div className="space-y-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          <p>
            {cvPhase === 'scoring'
              ? 'Scoring against the holdout is running — this refits nothing, it only scores the model already trained.'
              : isSelected
                ? "An estimate of the configuration, not the shipped model's own score — score it against the holdout in Evaluation."
                : "An estimate of the configuration, not the shipped model's own score. Select it to score it against the holdout in Evaluation."}
          </p>
          {cvPhase === 'awaiting-scoring' && isSelected && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 cursor-pointer gap-1 px-2 text-[10px]"
              onClick={() => {
                setHighestUnlocked(prev => Math.max(prev, 5))
                setCurrentStep(5)
              }}
            >
              Score in Evaluation
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {selectDisabledReason && (
        <p className="text-[10px] text-muted-foreground">
          {selectDisabledReason}
        </p>
      )}

      {!isSelected && (
        <Button
          size="sm"
          variant="outline"
          className="w-full cursor-pointer"
          disabled={selecting || selectDisabledReason !== null}
          title={selectDisabledReason ?? undefined}
          onClick={onSelect}
        >
          Select
        </Button>
      )}
    </div>
  )
}

/**
 * MODEL-FLOW-018-T04, extended by T05. The comparison table for runs no
 * ModelCandidateJob owns — sourced from `runs` (the draft's OWN run list,
 * passed down from `StandaloneSelection` below), never a job's candidates
 * array. Mirrors `CandidateComparison`'s shape (error/select-error handling,
 * refetch after select) without sharing its renderer, per T04's own
 * instruction. ROWS STILL ARE NOT SORTED BY METRIC — T05's own scope is
 * grouping and per-row labeling, not introducing a ranking that was never
 * requested; each group's rows stay in server order.
 */
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

  return (
    <div className="space-y-4">
      {selectError && <p className="text-xs text-red-500">{selectError}</p>}
      {groups.map(([targetY, groupRuns]) => (
        <div key={targetY} className="space-y-3">
          {multiTarget && (
            <p className="text-xs font-medium text-muted-foreground">
              y = {targetY}
            </p>
          )}
          <div
            className={cn(
              'grid gap-4',
              groupRuns.length > 1 && 'sm:grid-cols-2',
            )}
          >
            {groupRuns.map(run => (
              <StandaloneRunRow
                key={run.id}
                run={run}
                isSelected={run.id === selectedRunId}
                selecting={selectingRunId === run.id}
                comparabilityNote={comparabilityNote(run, groupRuns)}
                onSelect={() => void handleSelect(run.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * MODEL-FLOW-018-T04. Decides between the two standalone shapes: a single
 * selectable run still passes through via `SingleRunSummary`, and 2+
 * selectable runs — including two CV runs, which no sweep can ever group
 * (CV and Find Best Model are mutually exclusive) — get the comparison
 * table. Fetches the run list ONCE here and passes it down, rather than each
 * child fetching its own copy.
 *
 * MODEL-FLOW-018-T06 extends the single-run branch below with
 * `cvScoringPhase`/`holdoutRmse`, sourced from the same `selectedRun` this
 * branch already reads — see `SingleRunSummary`'s own doc comment.
 */
function StandaloneSelection({
  draftId,
  trainingResult,
}: {
  draftId: string
  trainingResult: DraftTrainingResult
}) {
  const { runs, loading, error } = useDraftRuns(draftId)
  const { selectedRunId, refetch: refetchSelection } =
    useDraftSelection(draftId)

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

  // Gate on SELECTABLE runs (SUCCEEDED), not the raw row count — `runs`
  // includes QUEUED/RUNNING/FAILED/CANCELED rows too, and a draft with one
  // SUCCEEDED run plus one FAILED attempt has exactly one candidate to
  // compare, matching MODEL-FLOW-013's own acceptance criterion ("a single
  // run must not stall") by what it actually means: nothing to CHOOSE
  // between, not merely "more than one row exists." The table, once it
  // opens, still renders every row (including non-SUCCEEDED ones, named with
  // their own reason) — the count below decides ONLY whether it opens.
  const selectableCount = runs.filter(r => r.status === 'SUCCEEDED').length
  if (selectableCount <= 1) {
    // Prefer the run `selectedRunId` names, if one is set and present in
    // the list — `trainingResult` is this SESSION's last completed run,
    // which can disagree with an explicit selection made on a different
    // (also-terminal) run earlier. Defensive: `launchDraftRun` clears
    // `selectedRunId` on every new launch and the SUCCEEDED count can only
    // grow, so a mismatch should not be reachable in the normal flow — but
    // an incorrect summary here would silently misname what Save Model
    // actually adopts, so this is cheap insurance rather than an assumption.
    const selectedRun = runs.find(r => r.id === selectedRunId)
    const summarySource: DraftTrainingResult = selectedRun
      ? {
          runId: selectedRun.id,
          algorithm: selectedRun.algorithm as Algorithm,
          metrics: selectedRun.metrics,
          trainedAt: selectedRun.createdAt,
          cvFoldsKey: selectedRun.cvFoldsKey,
        }
      : trainingResult
    // MODEL-FLOW-018-T06 (advisor-found gap, 2026-09-04). Only knowable from
    // the FULL run row, never from the `trainingResult` fallback — see
    // `SingleRunSummary`'s own doc comment for why `undefined` there is
    // correct, not a missing case.
    const cvScoringPhase =
      selectedRun && selectedRun.cvFoldsKey !== null
        ? cvScoringPhaseOf(selectedRun)
        : undefined
    const holdoutRmse =
      typeof selectedRun?.holdoutMetrics?.rmse === 'number'
        ? selectedRun.holdoutMetrics.rmse
        : null
    return (
      <SingleRunSummary
        trainingResult={summarySource}
        cvScoringPhase={
          cvScoringPhase === 'not-cv' ? undefined : cvScoringPhase
        }
        holdoutRmse={holdoutRmse}
      />
    )
  }

  return (
    <StandaloneComparison
      draftId={draftId}
      runs={runs}
      selectedRunId={selectedRunId}
      refetchSelection={refetchSelection}
    />
  )
}

/**
 * MODEL-FLOW-013, extended by MODEL-FLOW-018-T04. Compares each candidate an
 * algorithm sweep trained (Step 3's "Find Best Model") and lets the user
 * pick which one carries forward, or accept the metric's own answer.
 * `mpCandidateJobIdAtom` being null means there is no CURRENT sweep to show
 * via that path — it does NOT mean there is nothing to compare: a draft
 * whose runs were launched one at a time (including every CV run, which can
 * never belong to a sweep) now gets its own comparison
 * (`StandaloneSelection`), sourced from the draft's run list rather than a
 * job's candidates array. A draft with only one selectable run still passes
 * through honestly, no comparison table — MODEL-FLOW-013's own acceptance
 * criterion, unchanged by this feature.
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
    return (
      <StandaloneSelection draftId={draftId} trainingResult={trainingResult} />
    )
  }

  if (!draftId) {
    return <EmptyPanel>Model draft isn&apos;t ready yet.</EmptyPanel>
  }

  return <CandidateComparison draftId={draftId} jobId={candidateJobId} />
}
