'use client'

import { useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { AlertTriangle, Cpu, Loader2, Timer, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useModelTraining } from '@/hooks/model/use-model-training'
import { useModelDraftSync } from '@/hooks/model/use-model-draft-sync'
import { useRunConfigDraft } from '@/hooks/model/use-run-config-draft'
import { useArtifactSplitStats } from '@/hooks/dataset/artifact/use-artifact-split-stats'
import { useDraftRuns } from '@/hooks/model/use-draft-runs'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import {
  mpServerDraftIdAtom,
  mpSplitStatsTagsAtom,
} from '@/store/model-pipeline'
import { sourcedMetricsOf } from '@/lib/metric-source'
import { CoreConfig } from './training-config/core-config'
import { AutoMlToggles } from './training-config/automl-toggles'
import { RuntimeEstimate } from './training-config/runtime-estimate'
import { RunParamsPanel } from './training-config/run-params-panel'
import { SplitDistributionPanel } from './training-config/split-distribution-panel'
import { AlgorithmStack } from './training-config/algorithm-stack'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase3TrainingConfig({ nav }: Props) {
  const { selectedDataset, targetVariables, trainTestSplit } = nav
  const { ensureDraftId, flush } = useModelDraftSync({ autoSync: false })
  const runConfigDraft = useRunConfigDraft(nav)
  const { draft, dirty } = runConfigDraft
  const tags = selectedDataset?.tags ?? []

  const splitStatsTags = useAtomValue(mpSplitStatsTagsAtom)
  const targetY = targetVariables.length === 1 ? targetVariables[0]! : null
  const hasSequenceAlgorithm = nav.algorithms.some(
    a => a === 'lstm' || a === 'gru',
  )
  const enabledTargetY = hasSequenceAlgorithm ? null : targetY
  const cvMode = nav.nSplits !== undefined
  const hasArtifact = Boolean(selectedDataset?.currentArtifactId)
  const splitStats = useArtifactSplitStats(
    hasArtifact ? (selectedDataset?.id ?? null) : null,
    hasArtifact ? (selectedDataset?.currentArtifactId ?? null) : null,
    splitStatsTags,
    enabledTargetY,
    cvMode ? null : trainTestSplit / 100,
    cvMode ? nav.nSplits : undefined,
  )

  const training = useModelTraining({
    ensureDraftId,
    splitStats: splitStats.splitStats,
  })

  // MODEL-FLOW-019-T11 AC31. The draft's most recent SUCCEEDED run's own
  // figures, for the "current ratio" preview beside each acceptance
  // criterion's input — one extra GET on this screen (the run list is
  // already fetched separately by `RunParamsPanel`; deduping the two is a
  // follow-up, not this task). No `useCandidatePredictions` call here: SD
  // is not on the run row, and fetching a predictions batch to calibrate
  // one advisory input isn't worth a second request — an SD-bearing pair
  // states that plainly in `CoreConfig` instead of showing a number.
  const serverDraftId = useAtomValue(mpServerDraftIdAtom)
  const { runs: draftRuns } = useDraftRuns(serverDraftId)
  const mostRecentRun = draftRuns
    .filter(r => r.status === 'SUCCEEDED')
    .sort((a, b) => ((a.finishedAt ?? '') < (b.finishedAt ?? '') ? 1 : -1))[0]
  const currentRunMetrics = mostRecentRun
    ? sourcedMetricsOf(mostRecentRun)
    : null

  useEffect(() => {
    void flush()
  }, [flush])

  const nEstimators = draft.hyperparameters?.n_estimators
    ? Number(draft.hyperparameters.n_estimators)
    : undefined
  const rowCount = selectedDataset?.rowCount ?? 0

  const canTrain =
    targetVariables.length > 0 &&
    training.status !== 'training' &&
    tags.length > 0 &&
    !dirty

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Training configuration
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Configure the model and hyperparameters for{' '}
            <span className="font-medium text-foreground">
              {selectedDataset?.name || 'the dataset'}
            </span>
            .
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0 cursor-pointer"
        >
          <Upload className="h-4 w-4" />
          Upload Pipeline config
        </Button>
      </div>

      {tags.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Selected dataset has no tags — go back and choose a different dataset.
        </div>
      )}

      {/* Main Content: 2-Column Layout */}
      <div className="space-y-5">
        {/* Left Column: Form Configurations (takes up 2/3 space on large screens) */}
        <section className="space-y-4 rounded-xl border border-border/60 p-4 sm:p-5">
          <h3 className="text-sm font-medium text-foreground">
            Core configuration
          </h3>
          <CoreConfig
            tags={tags}
            targetVariables={draft.targetVariables}
            onTargetChange={runConfigDraft.setTargetVariable}
            lossFunction={draft.lossFunction}
            onLossChange={runConfigDraft.setLossFunction}
            trainTestSplit={draft.trainTestSplit}
            onSplitChange={runConfigDraft.setTrainTestSplit}
            seed={draft.seed}
            onSeedChange={runConfigDraft.setSeed}
            algorithms={draft.algorithms}
            nSplits={draft.nSplits}
            onNSplitsChange={runConfigDraft.setNSplits}
            findBestModel={draft.findBestModel}
            datasetId={selectedDataset?.id ?? null}
            artifactId={selectedDataset?.currentArtifactId ?? null}
            hasArtifact={hasArtifact}
            maxAdmissibleK={splitStats.splitStats?.max_admissible_k ?? null}
            splitStatsLoading={splitStats.loading}
            acceptanceCriteria={draft.acceptanceCriteria}
            onAcceptanceCriteriaChange={runConfigDraft.setAcceptanceCriteria}
            currentRunMetrics={currentRunMetrics}
          />
          {/* Deliberately fed the COMMITTED trainTestSplit/algorithms/
                targetVariables/nSplits (nav), not the draft above — this
                panel describes the split that will actually run. The fetch
                itself (splitStats) lives in THIS component, once per Apply,
                not once per keystroke (MODEL-FLOW-014-T08) — see its own
                declaration above for why it moved out of this panel. */}
          <SplitDistributionPanel
            datasetId={selectedDataset?.id ?? null}
            hasArtifact={hasArtifact}
            allTags={tags}
            targetVariables={targetVariables}
            algorithms={nav.algorithms}
            nSplits={nav.nSplits}
            splitStats={splitStats.splitStats}
            loading={splitStats.loading}
            missing={splitStats.missing}
            refusal={splitStats.refusal}
            error={splitStats.error}
          />
        </section>

        <section className="space-y-4 rounded-xl border border-border/60 p-4 sm:p-5">
          <h3 className="text-sm font-medium text-foreground">
            Algorithm &amp; hyperparameters
          </h3>
          <AlgorithmStack
            algorithms={draft.algorithms}
            onAlgorithmsChange={runConfigDraft.setAlgorithms}
            trainLabelledRows={
              splitStats.splitStats?.train_labelled_rows ?? null
            }
            perAlgorithmHyperparameters={draft.perAlgorithmHyperparameters}
            hyperparameters={draft.hyperparameters}
            onHyperparameterChange={runConfigDraft.setHyperparameter}
            findBestParams={draft.findBestParams}
          />

          <AutoMlToggles
            findBestModel={draft.findBestModel}
            onFindBestModel={runConfigDraft.setFindBestModel}
            findBestParams={draft.findBestParams}
            onFindBestParams={runConfigDraft.setFindBestParams}
            cvEnabled={draft.nSplits !== undefined}
            algorithms={draft.algorithms}
          />
        </section>

        {dirty && (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-500/20 sm:flex-row sm:items-center sm:justify-between dark:text-amber-400">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Unapplied changes — Start Training uses the last applied
              configuration until you Apply.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 cursor-pointer px-2 text-xs"
                onClick={runConfigDraft.discard}
              >
                Discard
              </Button>
              <Button
                size="sm"
                className="h-7 cursor-pointer px-2 text-xs"
                onClick={runConfigDraft.apply}
              >
                Apply
              </Button>
            </div>
          </div>
        )}

        {/* Training Actions */}
        <section className="space-y-4 rounded-xl border border-border/60 bg-muted/30 p-4 sm:p-5">
          <div className="flex items-center gap-2 border-b border-border/50 pb-2">
            <Timer className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">
              {training.status === 'training'
                ? 'Training progress'
                : 'Estimated runtime'}
            </h3>
          </div>

          <RuntimeEstimate
            rows={rowCount}
            features={Math.max(tags.length - draft.targetVariables.length, 1)}
            algorithms={draft.algorithms}
            targets={draft.targetVariables.length}
            findBestModel={draft.findBestModel}
            findBestParams={draft.findBestParams}
            nEstimators={nEstimators}
            status={training.status}
            progress={training.progress}
          />

          {/* The action and its own feedback on one line — the estimate above is
      read first by position, not by hoping the user looks right. */}
          <div className="flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row-reverse sm:items-center sm:justify-between">
            <Button
              onClick={training.start}
              disabled={!canTrain}
              className="w-full shrink-0 cursor-pointer gap-2 sm:w-auto"
            >
              {training.status === 'training' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Cpu className="h-4 w-4" />
              )}
              {training.status === 'training'
                ? 'Training…'
                : training.status === 'done'
                  ? 'Retrain'
                  : 'Start Training'}
            </Button>

            <div className="min-w-0 flex-1 space-y-1">
              {dirty && training.status !== 'training' && (
                <p className="text-xs text-muted-foreground">
                  Apply the changes above to start training with them.
                </p>
              )}
              {training.status === 'training' && (
                // A fit has no reportable percentage (MODEL-FLOW-003-T09) —
                // train.py emits log lines, not a fraction. Showing the latest one
                // is more honest than a bar that fakes a fraction.
                <p className="truncate text-xs text-muted-foreground">
                  {training.lastLog ?? 'Training container starting…'}
                </p>
              )}
              {training.status === 'error' && (
                <p className="text-xs text-destructive">{training.error}</p>
              )}
              {training.status === 'done' && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Training complete — continue to Results.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
      <RunParamsPanel />
    </div>
  )
}
