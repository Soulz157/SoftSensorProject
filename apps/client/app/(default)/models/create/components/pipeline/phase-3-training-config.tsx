'use client'

import { useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { AlertTriangle, Cpu, Loader2, Timer, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useModelTraining } from '@/hooks/model/use-model-training'
import { useModelDraftSync } from '@/hooks/model/use-model-draft-sync'
import { useRunConfigDraft } from '@/hooks/model/use-run-config-draft'
import { useArtifactSplitStats } from '@/hooks/dataset/artifact/use-artifact-split-stats'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { mpSplitStatsTagsAtom } from '@/store/model-pipeline'
import { CoreConfig } from './training-config/core-config'
import { AlgorithmSelector } from './training-config/algorithm-selector'
import { AutoMlToggles } from './training-config/automl-toggles'
import { DynamicHyperparameters } from './training-config/dynamic-hyperparameters'
import { RuntimeEstimate } from './training-config/runtime-estimate'
import { RunParamsPanel } from './training-config/run-params-panel'
import { SplitDistributionPanel } from './training-config/split-distribution-panel'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase3TrainingConfig({ nav }: Props) {
  const { selectedDataset, targetVariables, trainTestSplit } = nav
  // MODEL-FLOW-002: syncs Step 1 + Training Configuration (Step 3 as of
  // MODEL-FLOW-010) config to a server-side ModelDraft in the background.
  // MODEL-FLOW-014-T08: autoSync off — Core Config now commits on Apply,
  // not on change, so the debounced per-keystroke PATCH this hook used to
  // run would otherwise fire against config nothing has committed yet.
  const { ensureDraftId, flush } = useModelDraftSync({ autoSync: false })
  const runConfigDraft = useRunConfigDraft(nav)
  const { draft, dirty } = runConfigDraft
  const training = useModelTraining({ ensureDraftId })
  const tags = selectedDataset?.tags ?? []

  // MODEL-FLOW-016-T10. ONE fetch, shared by SplitDistributionPanel (the
  // box-plot / fold-plan render) and CoreConfig's own CvControl (the
  // max_admissible_k eligibility check) — each calling this hook
  // independently doubled the request per mount and, worse, CvControl's
  // own copy read the DRAFT trainTestSplit rather than the committed one,
  // refetching on every ratio-slider drag. Sourced from the COMMITTED
  // nav fields exactly like SplitDistributionPanel's own props already
  // were, so this changes nothing about WHEN it fetches (still once per
  // Apply, MODEL-FLOW-014-T08) — only WHERE the one fetch lives.
  const splitStatsTags = useAtomValue(mpSplitStatsTagsAtom)
  const targetY = targetVariables.length === 1 ? targetVariables[0]! : null
  const hasSequenceAlgorithm = nav.algorithms.some(
    a => a === 'lstm' || a === 'gru',
  )
  // lstm/gru cut on WINDOW count via a rule this endpoint does not
  // implement — same gate SplitDistributionPanel's own render branch
  // already applies; declining to fetch here is what keeps that branch
  // truthful rather than showing a tabular split as if it were theirs.
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

  // Flushes on mount (replacing autoSync's old mount PATCH — a user who
  // accepts every default must not leave the draft row never seeded) AND on
  // every subsequent change to the fields `flush`'s own `syncNow` reads
  // (target/algorithm/hyperparameters/split — `useModelDraftSync.ts`),
  // whether from Apply here or the Recall panel's Apply
  // (`useApplyRunParams`) writing the same atoms directly while Step 3
  // stays mounted. Depending on `flush` alone — not a hand-picked field
  // list — means this can't drift from what `syncNow` actually sends.
  // Deliberately an effect on the RESOLVED atoms via `flush`'s own identity,
  // not a callback fired from inside `runConfigDraft.apply()` itself — a
  // flush called synchronously there would still read the PREVIOUS render's
  // stale values, since `useModelDraftSync`'s own atom reads haven't
  // re-rendered yet at that point in the same click handler.
  useEffect(() => {
    void flush()
  }, [flush])

  const primaryAlgorithm = draft.algorithms[0] ?? 'ols'
  const showHyperparams = draft.algorithms.length === 1 && !draft.findBestParams

  const learningRate = draft.hyperparameters?.learning_rate
    ? Number(draft.hyperparameters.learning_rate)
    : 0.1
  const numLeaves = draft.hyperparameters?.num_leaves
    ? Number(draft.hyperparameters.num_leaves)
    : 31
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Form Configurations (takes up 2/3 space on large screens) */}
        <div className="lg:col-span-2 space-y-5">
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
            <AlgorithmSelector
              algorithms={draft.algorithms}
              onChange={runConfigDraft.setAlgorithms}
            />
            <AutoMlToggles
              findBestModel={draft.findBestModel}
              onFindBestModel={runConfigDraft.setFindBestModel}
              findBestParams={draft.findBestParams}
              onFindBestParams={runConfigDraft.setFindBestParams}
              cvEnabled={draft.nSplits !== undefined}
              algorithms={draft.algorithms}
            />
            {showHyperparams ? (
              <DynamicHyperparameters
                algorithm={primaryAlgorithm}
                hyperparameters={draft.hyperparameters}
                onChange={runConfigDraft.setHyperparameter}
              />
            ) : (
              <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Manual hyperparameters are managed automatically — turn off
                “Find Best Parameters” and select a single algorithm to tune
                them by hand.
              </p>
            )}
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
            {dirty && training.status !== 'training' && (
              <p className="text-xs text-muted-foreground">
                Apply the changes above to start training with them.
              </p>
            )}
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
                features={Math.max(
                  tags.length - draft.targetVariables.length,
                  1,
                )}
                algorithms={draft.algorithms}
                targets={draft.targetVariables.length}
                findBestModel={draft.findBestModel}
                findBestParams={draft.findBestParams}
                nEstimators={nEstimators}
                status={training.status}
                progress={training.progress}
              />
              <RunParamsPanel />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
