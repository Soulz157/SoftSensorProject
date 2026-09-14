'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  mpAcceptanceCriteriaAtom,
  mpCompareRunIdsAtom,
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpSelectedMetricsAtom,
} from '@/store/model-pipeline'
import { DEFAULT_RANK_METRIC, type RankMetricKey } from '@/lib/metric-ranking'
import {
  holdoutGroupMissingRateText,
  groupAbsenceText,
  holdoutSeriesAbsenceOf,
  scoreableRunIds,
} from '@/lib/metric-source'
// MODEL-FLOW-021-T01. These two moved out of this file unchanged so Step 3's
// own run comparison obeys the SAME comparability rules — see the module's
// own doc comment for why a second derivation would be a defect.
import { comparabilityNote, groupByTarget } from '@/lib/run-comparison'
import { useCandidatePredictions } from '@/hooks/model/use-candidate-predictions'
import { useDraftRuns } from '@/hooks/model/use-draft-runs'
import { useDraftSelection } from '@/hooks/model/use-draft-selection'
import { useArtifactHoldout } from '@/hooks/dataset/artifact/use-artifact-holdout'
import { cvScoringPhaseOf } from '@/hooks/model/use-draft-run-evaluation'
import { modelDraftRunService, modelDraftService } from '@/services/model-draft'
import type { ModelTrainingRunListItem } from '@/services/model-draft'
import { candidateFromRun } from '@/lib/candidate-from-run'
import { EmptyPanel } from './empty-panel'
import { CandidateOverlayChart } from './candidate-overlay-chart'
import { CandidateTable } from './candidate-table'
import { MetricsPicker } from './metrics-picker'

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
  refetchRuns,
}: {
  draftId: string
  runs: ModelTrainingRunListItem[]
  selectedRunId: string | null
  refetchSelection: () => void
  refetchRuns: () => void
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
  // MODEL-FLOW-019-T28. `loading` surfaced for the same reason as the job
  // path's.
  const { byRunId: holdoutByRunId, loading: holdoutLoading } =
    useCandidatePredictions(draftId, runIds, 'holdout')

  // MODEL-FLOW-019-T20 follow-up. The ONE dataset-level fact `candidateFromRun`
  // needs and a run row cannot answer itself — mirrors the job path's own
  // ONE lookup for the whole job (`reconcileAndShape`'s `datasetHasHoldout`),
  // here off the first run rather than a job root, since this view has no
  // single job to key off. `useArtifactHoldout` only ever CONFIRMS presence
  // or stays unknown — never a confirmed absence, per its own doc comment
  // (a 200-with-null payload here can still under-report relative to what
  // the scoring trigger itself checks, `lib/holdout-artifact.ts`'s wider
  // filter) — so `missing`/`error`/no-runs-yet all collapse to `null`
  // ("not recorded") rather than a false `'no-dataset-holdout'` that would
  // hide a real Score button.
  const holdoutSampleRun = runs.find(r => r.status === 'SUCCEEDED') ?? null
  const { holdout: artifactHoldout } = useArtifactHoldout(
    holdoutSampleRun?.datasetId ?? null,
    holdoutSampleRun?.goldArtifactId ?? null,
  )
  const datasetHasHoldout = artifactHoldout !== null ? true : null

  // MODEL-FLOW-019-T20 follow-up. Triggers holdout scoring for every
  // SUCCEEDED run in one group that is missing a series for a fixable
  // reason (`scoreableRunIds`) — mirrors `useDraftRunEvaluation`'s own
  // `triggerScoring`, but fans out over a group rather than one run, since
  // this screen compares many at once.
  const [scoreSubmitting, setScoreSubmitting] = useState(false)
  const [scoreError, setScoreError] = useState<string | null>(null)
  const handleScoreGroup = async (ids: string[]) => {
    if (ids.length === 0 || scoreSubmitting) return
    setScoreSubmitting(true)
    setScoreError(null)
    try {
      await Promise.all(ids.map(id => modelDraftRunService.score(draftId, id)))
      refetchRuns()
    } catch (err) {
      setScoreError(
        err instanceof Error ? err.message : 'Could not start scoring.',
      )
    } finally {
      setScoreSubmitting(false)
    }
  }
  // Polls while any run here is mid-scoring, so a container that finishes
  // without the user touching this screen still resolves into a chart —
  // same 2.5s cadence `useDraftRunEvaluation`'s own poll uses.
  const anyScoring = runs.some(r => r.scoringContainerId)
  useEffect(() => {
    if (!anyScoring) return
    const id = setInterval(() => refetchRuns(), 2500)
    return () => clearInterval(id)
  }, [anyScoring, refetchRuns])

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
      {scoreError && <p className="text-xs text-red-500">{scoreError}</p>}
      <MetricsPicker />
      {groups.map(([targetY, groupRuns]) => {
        const groupCandidates = groupRuns.map(run =>
          candidateFromRun(run, datasetHasHoldout),
        )
        // Structural view `groupAbsenceText` needs, computed once per group
        // so both charts below read the SAME per-candidate verdict.
        const groupAbsenceCandidates = groupCandidates.map(c => ({
          cvFoldsKey: c.cvFoldsKey,
          holdoutSeriesAbsence: holdoutSeriesAbsenceOf(c),
        }))
        const toScoreIds = scoreableRunIds(groupCandidates)
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
              absenceNote={groupAbsenceText(
                'test-split',
                groupAbsenceCandidates,
              )}
            />
            <CandidateOverlayChart
              candidates={groupCandidates}
              byRunId={holdoutByRunId}
              population="holdout"
              note={holdoutGroupMissingRateText(
                groupCandidates.map(c => c.sourcedMetrics),
              )}
              absenceNote={groupAbsenceText('holdout', groupAbsenceCandidates)}
              onScore={
                toScoreIds.length > 0
                  ? () => void handleScoreGroup(toScoreIds)
                  : undefined
              }
              scoreCount={toScoreIds.length}
              scoring={
                scoreSubmitting ||
                groupCandidates.some(c => c.scoringContainerId)
              }
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
              holdoutByRunId={holdoutByRunId}
              predictionsLoading={predictionsLoading}
              holdoutLoading={holdoutLoading}
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
export function StandaloneSelection({ draftId }: { draftId: string }) {
  const { runs, loading, error, refetch: refetchRuns } = useDraftRuns(draftId)
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
      refetchRuns={refetchRuns}
    />
  )
}
