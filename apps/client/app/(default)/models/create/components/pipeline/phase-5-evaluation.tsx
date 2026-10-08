'use client'

import { useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  AlertTriangle,
  CheckCircle2,
  Pencil,
  RotateCw,
  SlidersHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  METRIC_KEYS,
  METRIC_META,
  toggleMetricSelection,
  type MetricKey,
} from '@/lib/model-metrics'
import {
  mpSelectedMetricsAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
  ALGORITHM_LABELS,
  type Algorithm,
} from '@/store/model-pipeline'
import { useDraftRunEvaluation } from '@/hooks/model/use-draft-run-evaluation'
import { useMetricRegistryKeys } from '@/hooks/model/use-metric-registry'
import { isSequenceAlgorithm } from '@/lib/metric-source'
import { EmptyPanel } from './evaluation/empty-panel'
import { EvaluationPopulationPanel } from './evaluation/evaluation-population-panel'
import { CvFoldTable } from './evaluation/cv-fold-table'
import { FeatureImportanceTable } from './evaluation/feature-importance-table'
import {
  PermutationImportanceTable,
  FeatureImportanceEmptyPanel,
} from './evaluation/permutation-importance-table'
import { FeatureCountSweepLauncher } from './evaluation/feature-count-sweep-launcher'
import { FeatureCountSweepTable } from './evaluation/feature-count-sweep-table'
import { useFeatureCountSweep } from '@/hooks/model/use-feature-count-sweep'
import {
  DEFAULT_SWEEP_METRIC,
  seedMetricMeans,
  type SweepMetric,
} from '@/lib/feature-count-sweep'
import { useRunDistinctLabelled } from '@/hooks/model/use-run-distinct-labelled'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

interface Props {
  nav: UsePipelineNavResult
}

type EvaluationTab = 'own' | 'holdout'

/**
 * MODEL-FLOW-030. Step 5 shows ONE population at a time, behind tabs, for
 * every run: its own (the test split, or a CV run's out-of-fold series) and
 * the dataset's validation holdout. Each tab renders the same tiles and charts
 * (`EvaluationPopulationPanel`), so a CV run reads like a normal one.
 *
 * What describes the MODEL or the CONFIGURATION rather than a population —
 * feature importance, the feature-count sweep, the per-fold table — renders
 * once, below the tabs, so it cannot look population-specific or appear twice.
 */
export function Phase5Evaluation({ nav }: Props) {
  const [selectedMetrics, setSelectedMetrics] = useAtom(mpSelectedMetricsAtom)
  // MODEL-SERVE-006-T08. The picker's available OPTIONS now come from the
  // server registry — falls back to METRIC_KEYS while loading/on error, so
  // this never blocks or empties the picker.
  const registryKeys = useMetricRegistryKeys()
  const serverDraftId = useAtomValue(mpServerDraftIdAtom)
  const trainingResult = useAtomValue(mpTrainingResultAtom)

  const { run, manifest, own, holdout, loading, error, triggerScoring } =
    useDraftRunEvaluation(serverDraftId, trainingResult?.runId ?? null)
  // MODEL-FLOW-019-T31. ONE resolution for the three surfaces below that
  // need it — see useRunDistinctLabelled for why it is not read per panel.
  const distinctLabelled = useRunDistinctLabelled(
    run?.datasetId ?? null,
    run?.goldArtifactId ?? null,
    run?.targetY ?? null,
    run?.splitStats?.distinct_labelled_values ?? null,
  )

  const [sweepId, setSweepId] = useState<string | null>(null)
  /**
   * MODEL-FLOW-019-T35. The metric this sweep was LAUNCHED under, held in the
   * SAME local state as `sweepId` and for the same reason — never a fourth
   * schema column beside featureColumns/sweepId/sweepSeedRunId. Set only by
   * `onLaunched`, so the table renders the metric the fits were actually paid
   * for rather than whatever a control reads at render time.
   */
  const [sweepMetric, setSweepMetric] =
    useState<SweepMetric>(DEFAULT_SWEEP_METRIC)
  const sweep = useFeatureCountSweep(serverDraftId, sweepId)
  const { rmse: seedRmseMean, mae: seedMaeMean } = seedMetricMeans(run)

  const [tab, setTab] = useState<EvaluationTab>('own')
  const [scoringError, setScoringError] = useState<string | null>(null)
  const [triggering, setTriggering] = useState(false)
  const handleTriggerScoring = async () => {
    setTriggering(true)
    setScoringError(null)
    try {
      await triggerScoring()
    } catch (err) {
      setScoringError(
        err instanceof Error ? err.message : 'Could not start scoring.',
      )
    } finally {
      setTriggering(false)
    }
  }

  const toggleMetric = (key: MetricKey, on: boolean) => {
    setSelectedMetrics(prev => toggleMetricSelection(prev, key, on))
  }
  const visible = METRIC_KEYS.filter(k => selectedMetrics.includes(k))

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border p-4 text-sm text-muted-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <span>Could not load the evaluation — {error}</span>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="space-y-4">
        <EmptyPanel>
          No training run yet — start training in Step 3 to see evaluation here.
        </EmptyPanel>
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={() => nav.goTo(3)}>
            <RotateCw className="h-4 w-4" />
            Retrain
          </Button>
        </div>
      </div>
    )
  }

  if (run.status !== 'SUCCEEDED' || !own || !holdout) {
    const terminal = run.status === 'FAILED' || run.status === 'CANCELED'
    return (
      <div className="space-y-4">
        <EmptyPanel>
          {terminal
            ? `Training ${run.status.toLowerCase()}${
                run.failureReason ? ` — ${run.failureReason}` : '.'
              }`
            : 'Training is still running — evaluation will appear once it finishes.'}
        </EmptyPanel>
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={() => nav.goTo(3)}>
            <RotateCw className="h-4 w-4" />
            Retrain
          </Button>
        </div>
      </div>
    )
  }

  const algorithmLabel =
    ALGORITHM_LABELS[run.algorithm as Algorithm] ?? run.algorithm
  const isCv = Boolean(run.cvFoldsKey)
  const sequence = isSequenceAlgorithm(run.algorithm)
  const ownLabel = isCv ? 'Out-of-fold (CV)' : 'Test split'

  // Scoring is offered on the holdout tab only. Never when the holdout series
  // already exists (nothing left to trigger) and never for a sequence model
  // (no windowing path); a dataset with no holdout is refused by the server,
  // whose message lands in `scoringError`.
  const scoringAction = {
    unavailableReason: sequence
      ? `Holdout scoring has no windowing path for ${run.algorithm} — not available for this run.`
      : null,
    scoring: Boolean(run.scoringContainerId),
    triggering,
    error: scoringError,
    onScore: () => void handleTriggerScoring(),
  }

  const holdoutMetrics = run.holdoutMetrics
  const holdoutDropNote =
    holdoutMetrics &&
    (typeof holdoutMetrics.dropped_unlabelled === 'number' ||
      typeof holdoutMetrics.dropped_bad_features === 'number') ? (
      <p className="text-[11px] text-muted-foreground">
        Dropped {String(holdoutMetrics.dropped_unlabelled ?? 0)} unlabelled,{' '}
        {String(holdoutMetrics.dropped_bad_features ?? 0)} with bad features
        from the raw holdout before scoring.
      </p>
    ) : null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 px-4 py-3 ring-1 ring-emerald-500/20">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
        <div>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            Training complete
          </p>
          <p className="text-xs text-muted-foreground">
            {algorithmLabel} on {run.targetY}
            {isCv && run.cvFolds
              ? ` · ${run.cvFolds.n_splits}-fold cross-validation`
              : ''}
          </p>
        </div>
      </div>

      {manifest?.derivedFromTarget && manifest.derivedFromTarget.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Uses {manifest.derivedFromTarget.length} target-derived feature
          {manifest.derivedFromTarget.length === 1 ? '' : 's'} not shown here —
          serving this model will need target history at inference time.
        </p>
      )}

      <Tabs value={tab} onValueChange={v => setTab(v as EvaluationTab)}>
        {/* Toolbar: population switch + metric selector */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="own">{ownLabel}</TabsTrigger>
            <TabsTrigger value="holdout">Validation holdout</TabsTrigger>
          </TabsList>

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
              {registryKeys.map(key => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={selectedMetrics.includes(key)}
                  disabled={
                    selectedMetrics.length === 1 &&
                    selectedMetrics.includes(key)
                  }
                  onCheckedChange={on => toggleMetric(key, on)}
                >
                  {METRIC_META[key].label} ({METRIC_META[key].hint})
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <TabsContent value="own" className="pt-4">
          <EvaluationPopulationPanel
            evaluation={own}
            visibleMetrics={visible}
            cvFolds={run.cvFolds}
          />
        </TabsContent>
        <TabsContent value="holdout" className="pt-4">
          <EvaluationPopulationPanel
            evaluation={holdout}
            visibleMetrics={visible}
            cvFolds={null}
            note={holdoutDropNote}
            scoringAction={scoringAction}
          />
        </TabsContent>
      </Tabs>

      {/* MODEL-FLOW-023-T10. Two STACKED, independent sections (user,
          2026-09-15 — openDecision 1) — never one table with a fifth
          method folded in, and never the old `run.featureImportance ?
          Table : Empty` branch, which prints "no such quantity to read"
          directly above a fully populated permutation table for exactly
          the algorithms (lstm/gru) this feature exists to cover. The empty
          state now shows only when NEITHER artifact exists. */}
      {run.featureImportance && (
        <FeatureImportanceTable
          importance={run.featureImportance}
          derivedFromTarget={manifest?.derivedFromTarget ?? null}
          distinctLabelledValues={distinctLabelled.value}
          distinctLabelledSource={distinctLabelled.source}
          distinctLabelledLoading={distinctLabelled.loading}
        />
      )}
      {run.permutationImportance && (
        <PermutationImportanceTable
          importance={run.permutationImportance}
          derivedFromTarget={manifest?.derivedFromTarget ?? null}
        />
      )}
      {!run.featureImportance && !run.permutationImportance && (
        <FeatureImportanceEmptyPanel algorithmLabel={algorithmLabel} />
      )}

      {/* MODEL-FLOW-019-T31. The launcher and the curve it fills, beneath the
          importance table whose ranking both of them depend on. The table
          appears only once a sweep exists — there is no curve to read before
          one is launched, and an empty ladder would read as a measured flat
          line. */}
      <FeatureCountSweepLauncher
        draftId={serverDraftId}
        run={run}
        distinctLabelledValues={distinctLabelled.value}
        distinctLabelledLoading={distinctLabelled.loading}
        distinctLabelledReason={distinctLabelled.reason}
        seedRmseMean={seedRmseMean}
        seedMaeMean={seedMaeMean}
        onLaunched={(id, metric) => {
          setSweepId(id)
          setSweepMetric(metric)
        }}
      />

      {sweepId && run.featureImportance && (
        <FeatureCountSweepTable
          runs={sweep.runs}
          seedRunId={run.id}
          seedMethod={run.featureImportance.method}
          metric={sweepMetric}
          distinctLabelledValues={distinctLabelled.value}
          loading={sweep.loading}
          error={sweep.error}
        />
      )}

      {/* MODEL-FLOW-030. The per-fold table describes the CONFIGURATION, not
          a population, so it sits outside the tabs and shows as soon as the
          run has it — not only after holdout scoring. */}
      {run.cvFolds && <CvFoldTable cvFolds={run.cvFolds} />}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
        <Button variant="outline" onClick={() => nav.goTo(3)}>
          <RotateCw className="h-4 w-4" />
          Retrain
        </Button>
        <Button variant="outline" onClick={() => nav.goTo(1)}>
          <Pencil className="h-4 w-4" />
          Edit details
        </Button>
      </div>
    </div>
  )
}
