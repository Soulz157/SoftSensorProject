'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { Skeleton } from '@/components/ui/skeleton'
import {
  mpAcceptanceCriteriaAtom,
  mpCompareRunIdsAtom,
  mpSelectedMetricsAtom,
  ALGORITHM_LABELS,
  type Algorithm,
} from '@/store/model-pipeline'
import type { AcceptanceCriterion } from '@/lib/acceptance-criteria'
import { useCandidateJob } from '@/hooks/model/use-candidate-job'
import { useCandidatePredictions } from '@/hooks/model/use-candidate-predictions'
import type { MetricKey } from '@/lib/model-metrics'
import {
  holdoutGroupMissingRateText,
  groupAbsenceText,
  holdoutSeriesAbsenceOf,
  scoreableRunIds,
} from '@/lib/metric-source'
import { DEFAULT_RANK_METRIC, type RankMetricKey } from '@/lib/metric-ranking'
import {
  modelDraftCandidateJobService,
  modelDraftRunService,
} from '@/services/model-draft'
import type {
  CandidateResult,
  ModelCandidateJob,
  RunPredictionsBatchItem,
} from '@/services/model-draft'
import { EmptyPanel } from './empty-panel'
import { CandidateOverlayChart } from './candidate-overlay-chart'
import { CandidateTable } from './candidate-table'
import { MetricsPicker } from './metrics-picker'

function resolvedRunIdFor(job: ModelCandidateJob): string | null {
  return job.selectedRunId ?? job.bestRunId
}

export function CandidateComparison({
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
  const selectedMetrics = useAtomValue(mpSelectedMetricsAtom)
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
  // MODEL-FLOW-019-T28. `loading` surfaced (was discarded) — the expanded
  // row's Validate chart needs its own loading state, distinct from the
  // test-split fetch's.
  const { byRunId: holdoutByRunId, loading: holdoutLoading } =
    useCandidatePredictions(draftId, candidateRunIds, 'holdout')

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

  // MODEL-FLOW-019-T20 follow-up. Same scoring trigger as the standalone
  // path's own `handleScoreGroup` — see there for the full reasoning.
  // Duplicated as a CALL, not as a rule: both paths call the same
  // `modelDraftRunService.score`, `scoreableRunIds` and
  // `holdoutSeriesAbsenceOf`, just against a job's candidates instead of a
  // draft's runs.
  const [scoreSubmitting, setScoreSubmitting] = useState(false)
  const [scoreError, setScoreError] = useState<string | null>(null)
  const handleScoreGroup = async (ids: string[]) => {
    if (ids.length === 0 || scoreSubmitting) return
    setScoreSubmitting(true)
    setScoreError(null)
    try {
      await Promise.all(ids.map(id => modelDraftRunService.score(draftId, id)))
      refetch()
    } catch (err) {
      setScoreError(
        err instanceof Error ? err.message : 'Could not start scoring.',
      )
    } finally {
      setScoreSubmitting(false)
    }
  }
  const anyScoring = job?.candidates.some(c => c.scoringContainerId) ?? false
  useEffect(() => {
    if (!anyScoring) return
    const id = setInterval(() => refetch(), 2500)
    return () => clearInterval(id)
  }, [anyScoring, refetch])

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
      {scoreError && <p className="text-xs text-red-500">{scoreError}</p>}
      <MetricsPicker />
      <CandidateGroups
        candidates={visibleCandidates}
        resolvedRunId={resolvedRunId}
        selecting={selecting}
        onSelect={runId => void handleSelect(runId)}
        byRunId={byRunId}
        holdoutByRunId={holdoutByRunId}
        predictionsLoading={predictionsLoading}
        holdoutLoading={holdoutLoading}
        selectedMetrics={selectedMetrics}
        sortMetric={sortMetric}
        onSortMetric={setSortMetric}
        criteria={acceptanceCriteria}
        onScoreGroup={ids => void handleScoreGroup(ids)}
        scoreSubmitting={scoreSubmitting}
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
  holdoutLoading,
  selectedMetrics,
  sortMetric,
  onSortMetric,
  criteria,
  onScoreGroup,
  scoreSubmitting,
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
  /** MODEL-FLOW-019-T28. The holdout fetch's own loading state — the
   *  expanded row's Validate chart reads this, not `predictionsLoading`. */
  holdoutLoading: boolean
  selectedMetrics: MetricKey[]
  sortMetric: RankMetricKey
  onSortMetric: (key: RankMetricKey) => void
  criteria?: AcceptanceCriterion[]
  /** MODEL-FLOW-019-T20 follow-up. Fires with every runId in ONE phase
   *  group that `scoreableRunIds` names — never the whole job, so a
   *  Sweep-phase click cannot spawn containers for the Tuning phase too. */
  onScoreGroup: (runIds: string[]) => void
  scoreSubmitting: boolean
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
  const section = (group: CandidateResult[]) => {
    // Structural view `groupAbsenceText` needs, computed once per group so
    // both charts below read the SAME per-candidate verdict.
    const groupAbsenceCandidates = group.map(c => ({
      cvFoldsKey: c.cvFoldsKey,
      holdoutSeriesAbsence: holdoutSeriesAbsenceOf(c),
    }))
    const toScoreIds = scoreableRunIds(group)
    return (
      <div className="space-y-4">
        <CandidateOverlayChart
          candidates={group}
          byRunId={byRunId}
          population="test-split"
          absenceNote={groupAbsenceText('test-split', groupAbsenceCandidates)}
        />
        {/* MODEL-FLOW-019-T20. Beside the test-split overlay, never merged
            into it — the two windows are genuinely different data (the
            holdout is raw rows split off at BRONZE that no fit ever saw)
            and mistaking one for the other is what produced T19's report.

            STATES its absence rather than vanishing when no candidate here
            has a holdout series. It vanished at first, on the reasoning that
            a chart must not claim an absence it has not checked — but the
            absence IS checked: `groupAbsenceText` reads each candidate's own
            `holdoutSeriesAbsence`, the same field AC11 already refuses to
            leave blank in the table below (as `holdoutAbsence`). Vanishing
            was not modesty, it was the one state a reader cannot tell apart
            from a bug. */}
        <CandidateOverlayChart
          candidates={group}
          byRunId={holdoutByRunId}
          population="holdout"
          note={holdoutGroupMissingRateText(group.map(c => c.sourcedMetrics))}
          absenceNote={groupAbsenceText('holdout', groupAbsenceCandidates)}
          onScore={
            toScoreIds.length > 0 ? () => onScoreGroup(toScoreIds) : undefined
          }
          scoreCount={toScoreIds.length}
          scoring={scoreSubmitting || group.some(c => c.scoringContainerId)}
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
          holdoutByRunId={holdoutByRunId}
          predictionsLoading={predictionsLoading}
          holdoutLoading={holdoutLoading}
          criteria={criteria}
        />
      </div>
    )
  }

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
