'use client'

import { Fragment, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { ArrowUpDown } from 'lucide-react'
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
  mpSelectedMetricsAtom,
  ALGORITHM_LABELS,
  type Algorithm,
} from '@/store/model-pipeline'
import type {
  ModelTrainingRunListItem,
  RunPredictionsBatchItem,
} from '@/services/model-draft'
import { sourcedMetricsOf } from '@/lib/metric-source'
import { METRIC_META } from '@/lib/model-metrics'
import {
  DEFAULT_RANK_METRIC,
  rankCandidates,
  rankingSummaryText,
  type RankableRow,
  type RankMetricKey,
} from '@/lib/metric-ranking'
import { comparabilityNote, groupByTarget } from '@/lib/run-comparison'
import { useCandidatePredictions } from '@/hooks/model/use-candidate-predictions'
import {
  CandidateOverlayChart,
  type OverlaySeries,
} from '../model-selection/candidate-overlay-chart'
// MODEL-FLOW-021-T01/T03. These five are the SAME cells/table vocabulary
// Step 4's CandidateTable already renders with — exported (not copied) so a
// metric never gets two column widths, two roundings or two "sd is n/a"
// spellings between the two steps. See this file's own doc comment below
// for what is deliberately NOT reused.
import {
  MetricSourceCell,
  RANK_ARIA,
  STATUS_META,
  STEP4_COLUMN_ORDER,
  UNRANKED_LABELS,
  VALIDATE_COLUMN_CLASS,
  isRankMetricKey,
} from '../phase-4-model-selection'

/**
 * MODEL-FLOW-021-T03/T22. Step 3's own run comparison — a ranked table plus
 * an overlay chart per targetY group, driven by the run cards' Compare
 * checkbox (`RunParamsPanel`'s `comparedTerminal`).
 *
 * RECOVERED, NOT NEW. `lib/run-comparison.ts`'s own doc comment named this
 * exact path as the reason that module was extracted, T02 widened
 * `CandidateOverlayChart` for it by name, and `run-comparison-panel.test.tsx`
 * has asserted its shape since 2026-09-07 — but the component itself was
 * never committed to the tree (MODEL-FLOW-019-T22's own audit: absent from
 * every commit, every stash, every reflog entry, every dangling git object).
 * Whether it was lost to a concurrent session or the original "completed"
 * result was never actually true cannot be settled from git history alone,
 * and does not change what this file needs to do — see T22's own result for
 * the correction to MODEL-FLOW-021-T03/V01's status.
 *
 * WHAT IS DELIBERATELY NOT REUSED FROM CandidateTable, per that finding:
 * (1) NO holdoutAbsence. MODEL-FLOW-021's own findings: "Step 3 does not
 *     know whether the dataset has a holdout, so supplying it would
 *     fabricate an explanation" — `candidateFromRun`'s `datasetHasHoldout`
 *     answer is not available here, so an absent holdout figure renders a
 *     plain em dash, never a stated reason.
 * (2) NO residual SD figure. Step 4's `sd` column reads
 *     `useCandidatePredictions`' batch response through `residualSdOf`; this
 *     panel fetches that same batch only for the overlay chart's series, not
 *     to compute a per-row SD, so the column renders the literal `n/a` its
 *     own header already promises rather than a number this table cannot
 *     honestly produce a second way.
 * (3) NO action/criteria columns, no per-row chart disclosure toggle, no
 *     metric picker of its own — this table always shows the picker's
 *     current selection (`mpSelectedMetricsAtom`, shared with Step 4) but
 *     does not offer its own control to change it; Step 4's picker is one
 *     click away and writes the same atom.
 * (4) A CV candidate's Test column reads the literal "N/A — cross-
 *     validation" rather than Step 4's `CvEstimateCell` (mean +/- std) — a
 *     narrower statement Step 3 can make without also carrying that cell's
 *     own scored-vs-unscored branching.
 */
interface Props {
  draftId: string
  runs: ModelTrainingRunListItem[]
}

interface ComparisonRow extends RankableRow {
  run: ModelTrainingRunListItem
}

function comparisonRowOf(run: ModelTrainingRunListItem): ComparisonRow {
  return {
    run,
    status: run.status,
    sourcedMetrics: sourcedMetricsOf(run),
    // `holdoutAbsence` intentionally omitted — see this file's doc comment.
  }
}

export function RunComparisonPanel({ draftId, runs }: Props) {
  const groups = useMemo(() => groupByTarget(runs), [runs])
  // One batched fetch for every group's overlay chart, keyed by runId —
  // mirrors Step 4's job-path call, which also fetches once for every
  // candidate rather than once per phase group.
  const runIds = useMemo(
    () => runs.filter(r => r.status === 'SUCCEEDED').map(r => r.id),
    [runs],
  )
  const { byRunId } = useCandidatePredictions(draftId, runIds)

  return (
    <div className="space-y-6">
      {groups.map(([targetY, groupRuns]) => (
        <ComparisonGroup
          key={targetY}
          targetY={targetY}
          runs={groupRuns}
          // AC7/T01. A single-target draft — the common case — gets no
          // header naming the one target every row already repeats.
          showTargetHeader={groups.length > 1}
          byRunId={byRunId}
        />
      ))}
    </div>
  )
}

function ComparisonGroup({
  targetY,
  runs,
  showTargetHeader,
  byRunId,
}: {
  targetY: string
  runs: ModelTrainingRunListItem[]
  showTargetHeader: boolean
  byRunId: Map<string, RunPredictionsBatchItem>
}) {
  const [sortMetric, setSortMetric] =
    useState<RankMetricKey>(DEFAULT_RANK_METRIC)
  const selectedMetrics = useAtomValue(mpSelectedMetricsAtom)
  const visibleMetrics = STEP4_COLUMN_ORDER.filter(key =>
    selectedMetrics.includes(key),
  )

  const rows = useMemo(() => runs.map(comparisonRowOf), [runs])
  const ranking = useMemo(
    () => rankCandidates(rows, sortMetric),
    [rows, sortMetric],
  )
  const summary = rankingSummaryText(ranking)

  const overlayCandidates: OverlaySeries[] = runs.map(run => ({
    runId: run.id,
    algorithm: run.algorithm,
  }))

  return (
    <div className="space-y-2">
      {showTargetHeader && (
        <p className="text-xs font-medium text-foreground">{`y = ${targetY}`}</p>
      )}
      <CandidateOverlayChart
        candidates={overlayCandidates}
        byRunId={byRunId}
        // MODEL-FLOW-019-T20. Explicit and never derived — Step 3 has no
        // holdout-series knowledge of its own (see this file's doc
        // comment), so this chart draws the test split only.
        population="test-split"
      />
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
                        onClick={() => setSortMetric(key as RankMetricKey)}
                        title={`Rank by ${METRIC_META[key].label}`}
                      >
                        {METRIC_META[key].label}
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    ) : (
                      <span
                        className="text-muted-foreground"
                        title="Not a sort target — no run-row source here carries a residual SD figure."
                      >
                        {METRIC_META[key].label}
                      </span>
                    )}
                  </TableHead>
                )
              })}
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
              const run = entry.row.run
              const algorithmLabel =
                ALGORITHM_LABELS[run.algorithm as Algorithm] ?? run.algorithm
              const status = STATUS_META[run.status]
              const StatusIcon = status.icon
              const note = comparabilityNote(run, runs)
              const testMetric =
                entry.row.sourcedMetrics.find(m => m.source !== 'holdout') ??
                null
              const holdoutMetric =
                entry.row.sourcedMetrics.find(m => m.source === 'holdout') ??
                null
              const isCvTest = testMetric?.source === 'cv-fold-estimate'
              return (
                <TableRow key={run.id}>
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
                        className={cn('h-3.5 w-3.5 shrink-0', status.className)}
                      />
                      <span className="font-medium text-foreground">
                        {algorithmLabel}
                      </span>
                    </div>
                    {note && (
                      <p className="text-[10px] italic text-muted-foreground">
                        {note}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {status.label}
                    </span>
                    {run.failureReason && (
                      <p className="text-[11px] text-red-500">
                        {run.failureReason}
                      </p>
                    )}
                  </TableCell>
                  {visibleMetrics.map(key =>
                    isRankMetricKey(key) ? (
                      <Fragment key={key}>
                        {isCvTest ? (
                          <MetricSourceCell
                            metric={null}
                            metricKey={key}
                            emptyReason="N/A — cross-validation"
                          />
                        ) : (
                          <MetricSourceCell
                            metric={testMetric}
                            metricKey={key}
                          />
                        )}
                        <MetricSourceCell
                          metric={holdoutMetric}
                          metricKey={key}
                          highlighted
                        />
                      </Fragment>
                    ) : (
                      // Only `sd` reaches here — see this file's doc
                      // comment part (2) for why it is always `n/a`.
                      <Fragment key={key}>
                        <TableCell className="text-right">
                          <span className="font-mono text-xs text-muted-foreground">
                            n/a
                          </span>
                        </TableCell>
                        <TableCell
                          className={cn('text-right', VALIDATE_COLUMN_CLASS)}
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            n/a
                          </span>
                        </TableCell>
                      </Fragment>
                    ),
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
