'use client'

import {
  AlertTriangle,
  Cpu,
  Info,
  LineChart,
  Loader2,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useModelTraining } from '@/hooks/model/use-model-training'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { CoreConfig } from './training-config/core-config'
import { AlgorithmSelector } from './training-config/algorithm-selector'
import { AutoMlToggles } from './training-config/automl-toggles'
import { DynamicHyperparameters } from './training-config/dynamic-hyperparameters'

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
  const training = useModelTraining()
  const tags = selectedDataset?.tags ?? []

  // Primary algorithm drives the manual hyperparameter grid, which is only
  // relevant for a single algorithm with AutoML tuning off.
  const primaryAlgorithm = algorithms[0] ?? 'ols'
  const showHyperparams = algorithms.length === 1 && !findBestParams

  const learningRate = hyperparameters?.learning_rate
    ? Number(hyperparameters.learning_rate)
    : 0.1
  const numLeaves = hyperparameters?.num_leaves
    ? Number(hyperparameters.num_leaves)
    : 31
  const complexityScore = Math.min((numLeaves / 100) * 100, 100)

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
              <Progress value={training.progress} className="h-1.5" />
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
              <LineChart className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-medium text-foreground">
                Algorithm Insights
              </h3>
            </div>

            {/* Mockup Visualization for Algorithm Behavior */}
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    Model Complexity
                  </span>
                  <span className="font-medium">
                    {complexityScore.toFixed(0)}%
                  </span>
                </div>
                {/* Visual Indicator for Complexity */}
                <div className="h-2 w-full rounded-full bg-secondary overflow-hidden flex">
                  <div
                    className={`h-full transition-all duration-300 ${complexityScore > 70 ? 'bg-amber-500' : 'bg-primary'}`}
                    style={{ width: `${complexityScore}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground pt-1">
                  {complexityScore > 70
                    ? 'High complexity. Watch out for overfitting.'
                    : 'Balanced complexity based on Num leaves.'}
                </p>
              </div>

              <div className="rounded-lg bg-background p-3 border border-border/50 space-y-2">
                <div className="flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-foreground leading-relaxed">
                    With{' '}
                    <span className="font-medium">
                      Learning Rate {learningRate}
                    </span>
                    , the model will{' '}
                    {learningRate > 0.1
                      ? 'converge quickly but might miss the global minimum.'
                      : 'learn steadily. Requires more boosting rounds.'}
                  </p>
                </div>
              </div>

              {/* Placeholder for real charts (e.g., Recharts) */}
              <div className="h-32 w-full rounded-lg border border-dashed border-border flex items-center justify-center bg-background/50">
                <p className="text-xs text-muted-foreground text-center px-4">
                  (Learning Curve Chart Placeholder)
                  <br />
                  <span className="text-[10px]">Integrate Recharts here</span>
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
