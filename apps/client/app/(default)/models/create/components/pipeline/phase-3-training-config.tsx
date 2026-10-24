'use client'

import { useEffect, useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { AlertTriangle, Upload } from 'lucide-react'
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
import { datasetSizeFrom } from '@/lib/hyperparam-ranges'
import { planTrainingLaunch } from '@/lib/training-launch'
import { useFineTune } from '@/hooks/model/use-fine-tune'
import { baseHyperparamsFor } from '@/lib/tuning-preview'
import { CoreConfig } from './training-config/core-config'
import { RunParamsPanel } from './training-config/run-params-panel'
import { SplitDistributionPanel } from './training-config/split-distribution-panel'
import {
  AlgorithmStack,
  AlgorithmStackSummary,
} from './training-config/algorithm-stack'
import { FineTuneSection } from './training-config/fine-tune-section'
import { TrainingActions } from './training-config/training-actions'

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

  // MODEL-FLOW-024. The size the suggested ranges are chosen by. `rows` picks
  // the tier and the LSTM/GRU batch cap: the split stats' `source_rows` once
  // Apply has fetched them, else the dataset's own row count (that fetch waits
  // for Apply and is skipped while lstm/gru is selected). `useModelTraining`
  // sends the job the same figure through `datasetSizeFrom`. Distinct labelled
  // values come only from the split stats and pick nothing.
  //
  // `featureCount` is the figure the runtime estimate already used: dataset tags
  // minus the target(s). Only pls reads it (its components cannot exceed it).
  const featureCount = Math.max(tags.length - draft.targetVariables.length, 1)
  const datasetSize = useMemo(
    () =>
      datasetSizeFrom(
        splitStats.splitStats,
        selectedDataset?.rowCount,
        featureCount,
      ),
    [splitStats.splitStats, selectedDataset?.rowCount, featureCount],
  )

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

  // The same refusals Start would raise (LSTM/GRU beside another algorithm,
  // CV with two algorithms), stated before the click rather than after it. Read off the draft the user is editing.
  const launchRefusal = useMemo(() => {
    try {
      planTrainingLaunch({
        algorithms: draft.algorithms,
        baseFor: a =>
          baseHyperparamsFor(
            a,
            draft.algorithms,
            draft.hyperparameters,
            draft.perAlgorithmHyperparameters,
          ),
        nSplits: draft.nSplits,
      })
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'These settings cannot start.'
    }
  }, [draft])

  // MODEL-FLOW-036. ONE Start for both rounds (Hick's law: one primary
  // action per decision, the wizard footer owns Next). Its mode is the
  // Fine-tune switch: off trains every algorithm once with its card values,
  // on fine-tunes the run picked in the Fine-tune section right above it.
  const fineTune = useFineTune({
    nav,
    training: training.status === 'training',
    datasetSize,
  })
  const fineTuning = fineTune.active
  const refusal = fineTuning ? fineTune.refusal : launchRefusal

  const canTrain =
    targetVariables.length > 0 &&
    training.status !== 'training' &&
    tags.length > 0 &&
    !dirty &&
    refusal === null
  const startTraining = fineTuning
    ? () => training.fineTune(fineTune.input)
    : training.start

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Model configuration
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

      {/* MODEL-FLOW-036. Inputs in the order the user decides them — the
          algorithm(s) first (they gate CV, seed and the split stats below),
          then core configuration, then Fine-tune — then the ONE action, then
          its output (Run parameters). */}
      <div className="space-y-5">
        <section className="space-y-4 rounded-xl border border-border/60 p-4 sm:p-5">
          <h3 className="text-sm font-medium text-foreground">
            Algorithm &amp; hyperparameters
          </h3>
          {fineTuning ? (
            <AlgorithmStackSummary
              algorithms={draft.algorithms}
              onEdit={() => fineTune.setEnabled(false)}
            />
          ) : (
            <AlgorithmStack
              algorithms={draft.algorithms}
              onAlgorithmsChange={runConfigDraft.setAlgorithms}
              trainLabelledRows={
                splitStats.splitStats?.train_labelled_rows ?? null
              }
              perAlgorithmHyperparameters={draft.perAlgorithmHyperparameters}
              hyperparameters={draft.hyperparameters}
              onHyperparameterChange={runConfigDraft.setHyperparameter}
              datasetSize={datasetSize}
            />
          )}
        </section>

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

        {dirty && (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-500/20 sm:flex-row sm:items-center sm:justify-between dark:text-amber-400">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Unapplied changes — Start uses the last applied configuration
              until you Apply.
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

        {/* MODEL-FLOW-035/036. Round 2's choices sit right above the one Start
            they arm (proximity); each card already carries its run's score,
            so picking needs no scroll down to Run parameters. Locked until a
            run succeeds. */}
        <FineTuneSection
          fineTune={fineTune}
          nSplits={nav.nSplits}
          datasetSize={datasetSize}
        />

        <TrainingActions
          estimate={
            fineTuning
              ? {
                  rows: rowCount,
                  features: featureCount,
                  targets: draft.targetVariables.length,
                  nSplits: draft.nSplits,
                  algorithms: [fineTune.algorithm],
                  findBestParams: fineTune.useGrid,
                  tuningVariants: fineTune.tuningVariants,
                  candidatesPerAlgorithm: fineTune.candidatesPerAlgorithm,
                  nEstimators:
                    typeof fineTune.base.n_estimators === 'number'
                      ? fineTune.base.n_estimators
                      : undefined,
                }
              : {
                  rows: rowCount,
                  features: featureCount,
                  targets: draft.targetVariables.length,
                  nSplits: draft.nSplits,
                  algorithms: draft.algorithms,
                  findBestParams: false,
                  nEstimators,
                }
          }
          train={training}
          // The action keeps its name on every press: a second Start Training
          // is another training run, not a different operation.
          label={fineTuning ? 'Start Fine-tune' : 'Start Training'}
          onStart={startTraining}
          disabled={!canTrain}
          refusal={refusal}
          dirty={dirty}
          doneText={
            fineTuning
              ? 'Fine-tune complete — continue to Model Selection.'
              : 'Training complete — turn on Fine-tune above to tune a run, or continue to Model Selection.'
          }
        />
      </div>
      <RunParamsPanel />
    </div>
  )
}
