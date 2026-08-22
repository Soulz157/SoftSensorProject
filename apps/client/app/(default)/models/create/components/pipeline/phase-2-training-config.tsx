'use client'

import { AlertTriangle, Cpu, Loader2, Timer, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useModelTraining } from '@/hooks/model/use-model-training'
import { useModelDraftSync } from '@/hooks/model/use-model-draft-sync'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { CoreConfig } from './training-config/core-config'
import { AlgorithmSelector } from './training-config/algorithm-selector'
import { AutoMlToggles } from './training-config/automl-toggles'
import { DynamicHyperparameters } from './training-config/dynamic-hyperparameters'
import { RuntimeEstimate } from './training-config/runtime-estimate'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase2TrainingConfig({ nav }: Props) {
  const {
    selectedDataset,
    algorithms,
    findBestModel,
    findBestParams,
    targetVariables,
    hyperparameters,
    lossFunction,
    trainTestSplit,
  } = nav
  // MODEL-FLOW-002: syncs Step 1 + Training Configuration (Step 3 as of
  // MODEL-FLOW-010) config to a server-side ModelDraft in the background.
  // This component mounting IS "advancing to Training Configuration" —
  // canAdvance(1) already validated workspace/plant/node/dataset/name, and
  // Step 2 (Dataset Review) configures nothing of its own to sync, before
  // the wizard let the user get here.
  const { ensureDraftId } = useModelDraftSync()
  const training = useModelTraining({ ensureDraftId })
  const tags = selectedDataset?.tags ?? []

  const primaryAlgorithm = algorithms[0] ?? 'ols'
  const showHyperparams = algorithms.length === 1 && !findBestParams

  const learningRate = hyperparameters?.learning_rate
    ? Number(hyperparameters.learning_rate)
    : 0.1
  const numLeaves = hyperparameters?.num_leaves
    ? Number(hyperparameters.num_leaves)
    : 31
  const nEstimators = hyperparameters?.n_estimators
    ? Number(hyperparameters.n_estimators)
    : undefined
  const rowCount = selectedDataset?.rowCount ?? 0

  const canTrain =
    targetVariables.length > 0 &&
    training.status !== 'training' &&
    tags.length > 0

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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Form Configurations (takes up 2/3 space on large screens) */}
        <div className="lg:col-span-2 space-y-5">
          <section className="space-y-4 rounded-xl border border-border/60 p-4 sm:p-5">
            <h3 className="text-sm font-medium text-foreground">
              Core configuration
            </h3>
            <CoreConfig
              tags={tags}
              targetVariables={targetVariables}
              onTargetChange={nav.setTargetVariable}
              lossFunction={lossFunction}
              onLossChange={nav.setLossFunction}
              trainTestSplit={trainTestSplit}
              onSplitChange={nav.setTrainTestSplit}
            />
          </section>

          <section className="space-y-4 rounded-xl border border-border/60 p-4 sm:p-5">
            <h3 className="text-sm font-medium text-foreground">
              Algorithm &amp; hyperparameters
            </h3>
            <AlgorithmSelector
              algorithms={algorithms}
              onChange={nav.setAlgorithms}
            />
            <AutoMlToggles
              findBestModel={findBestModel}
              onFindBestModel={nav.setFindBestModel}
              findBestParams={findBestParams}
              onFindBestParams={nav.setFindBestParams}
            />
            {showHyperparams ? (
              <DynamicHyperparameters
                algorithm={primaryAlgorithm}
                hyperparameters={hyperparameters}
                onChange={nav.setHyperparameter}
              />
            ) : (
              <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Manual hyperparameters are managed automatically — turn off
                “Find Best Parameters” and select a single algorithm to tune
                them by hand.
              </p>
            )}
          </section>

          {/* Training Actions */}
          <div className="space-y-3 pt-2">
            <Button
              onClick={training.start}
              disabled={!canTrain}
              className="gap-2 w-full sm:w-auto"
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
            {training.status === 'training' && (
              // A fit has no reportable percentage (MODEL-FLOW-003-T09) —
              // train.py emits log lines, not a fraction. Showing the
              // latest one is more honest than a bar that fakes a fraction.
              <p className="text-xs text-muted-foreground truncate">
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

        {/* Right Column: Visualization & Insights (takes up 1/3 space) */}
        <div className="lg:col-span-1">
          <section className="sticky top-6 space-y-4 rounded-xl border border-border/60 bg-muted/30 p-4 sm:p-5">
            <div className="flex items-center gap-2 pb-2 border-b border-border/50">
              <Timer className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-medium text-foreground">
                Algorithm Insights
              </h3>
            </div>

            {/* Mockup Visualization for Algorithm Behavior */}
            <div className="space-y-4 pt-2">
              <RuntimeEstimate
                rows={rowCount}
                features={Math.max(tags.length - targetVariables.length, 1)}
                algorithms={algorithms}
                targets={targetVariables.length}
                findBestModel={findBestModel}
                findBestParams={findBestParams}
                nEstimators={nEstimators}
                status={training.status}
                progress={training.progress}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
