'use client'

import { useMemo, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  PlayCircle,
  RotateCw,
  SlidersHorizontal,
} from 'lucide-react'
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
import { cn } from '@/lib/utils'
import {
  buildFitRows,
  METRIC_KEYS,
  METRIC_META,
  toggleMetricSelection,
  type MetricKey,
} from '@/lib/model-metrics'
import { pickTimeFormat, type BrushWindow } from '@/lib/monitoring'
import {
  mpSelectedMetricsAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
  ALGORITHM_LABELS,
  type Algorithm,
} from '@/store/model-pipeline'
import {
  useDraftRunEvaluation,
  cvScoringPhaseOf,
} from '@/hooks/model/use-draft-run-evaluation'
import { useMetricRegistryKeys } from '@/hooks/model/use-metric-registry'
import { ChartZoomControls } from '@/components/charts/chart-zoom-controls'
import { residualHistogram, qqPoints } from '@/lib/model-evaluation'
import {
  populationOf,
  populationLabel,
  populationAxisLabel,
  populationTitle,
} from '@/lib/metric-source'
import { StatTile } from '../stat-tile'
import {
  ActualVsPredictedChart,
  AVP_LEGEND,
} from './evaluation/actual-vs-predicted-chart'
import { ParityScatterChart } from './evaluation/parity-scatter-chart'
import { ResidualChart, RESIDUAL_LEGEND } from './evaluation/residual-chart'
import { ResidualHistogramChart } from './evaluation/residual-histogram-chart'
import { QQPlotChart } from './evaluation/qq-plot-chart'
import { EmptyPanel } from './evaluation/empty-panel'
import { CvFoldTable } from './evaluation/cv-fold-table'
import { FeatureImportanceTable } from './evaluation/feature-importance-table'
import { useRunDistinctLabelled } from '@/hooks/model/use-run-distinct-labelled'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { ChartLegend } from '@/components/charts/chart-legend'
import { PARITY_LEGEND } from './evaluation/parity-scatter-chart'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase5Evaluation({ nav }: Props) {
  const [selectedMetrics, setSelectedMetrics] = useAtom(mpSelectedMetricsAtom)
  // MODEL-SERVE-006-T08. The picker's available OPTIONS now come from the
  // server registry — falls back to METRIC_KEYS while loading/on error, so
  // this never blocks or empties the picker.
  const registryKeys = useMetricRegistryKeys()
  const serverDraftId = useAtomValue(mpServerDraftIdAtom)
  const trainingResult = useAtomValue(mpTrainingResultAtom)

  const { run, fit, manifest, parityRange, loading, error, triggerScoring } =
    useDraftRunEvaluation(serverDraftId, trainingResult?.runId ?? null)
  // MODEL-FLOW-019-T31. ONE resolution for the three surfaces below that
  // need it — see useRunDistinctLabelled for why it is not read per panel.
  const distinctLabelled = useRunDistinctLabelled(
    run?.datasetId ?? null,
    run?.goldArtifactId ?? null,
    run?.targetY ?? null,
    run?.splitStats?.distinct_labelled_values ?? null,
  )

  const cvPhase = cvScoringPhaseOf(run)
  const population = populationOf(cvPhase)
  const populationText = populationLabel(population)
  const parityDomain = useMemo<[number, number] | null>(() => {
    if (!parityRange) return null
    return [
      Math.min(parityRange.yTrueMin, parityRange.yPredMin),
      Math.max(parityRange.yTrueMax, parityRange.yPredMax),
    ]
  }, [parityRange])
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

  // residual SD). No compared series — MODEL-FLOW-007 has not landed, so no
  // saved Model can supply a real predicted series to compare against (see
  // the disabled control below).
  const rows = useMemo(
    () => (fit ? buildFitRows(fit.points, fit.sd) : []),
    [fit],
  )

  // Residual diagnostics (histogram + Q-Q) — computed over the full run, not
  // the zoom window, so the distribution reflects every test-split sample.
  const residuals = useMemo(
    () => (fit ? fit.points.map(p => p.residual) : []),
    [fit],
  )
  const histogramBins = useMemo(() => residualHistogram(residuals), [residuals])
  const qq = useMemo(() => qqPoints(residuals), [residuals])

  // Shared zoom window — applied by slicing rows, so both charts move together.
  const [zoom, setZoom] = useState<BrushWindow>({})
  const visibleRows = useMemo(() => {
    const start = zoom.startIndex ?? 0
    const end = zoom.endIndex ?? Math.max(0, rows.length - 1)
    return rows.slice(start, end + 1)
  }, [rows, zoom])

  const tickFormatter = useMemo(() => {
    const first = visibleRows[0]
    const last = visibleRows[visibleRows.length - 1]
    return pickTimeFormat(first && last ? last.t - first.t : 0)
  }, [visibleRows])

  // 3 decimal places for every metric card on THIS step — R² already
  // formatted this way (`METRIC_META.r2.format`); RMSE/MAE/SD used a
  // 2-digit formatter shared with `run-params-panel.tsx`, so this reads
  // straight off `fit` rather than widening that shared formatter's
  // precision for a step that did not ask for it.
  const valueFor = (key: MetricKey): string => {
    if (!fit || fit.n < 2) return '—'
    return fit[key].toFixed(3)
  }
  const accentFor = (key: MetricKey): string | undefined => {
    if (!fit || fit.n < 2) return undefined
    return METRIC_META[key].accent?.(fit[key])
  }

  const toggleMetric = (key: MetricKey, on: boolean) => {
    setSelectedMetrics(prev => toggleMetricSelection(prev, key, on))
  }

  const visible = METRIC_KEYS.filter(k => selectedMetrics.includes(k))
  const hasFit = Boolean(fit && fit.points.length >= 2)

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

  // No run at all — the draft has not trained yet. Includes edit mode
  // (MODEL-FLOW-007-T11 unblocks it): editing an existing Model unlocks this
  // step with no ModelDraft/run behind it, so this is the honest state
  // rather than a stale client-computed placeholder.
  if (!run) {
    return (
      <div className="space-y-4">
        <EmptyPanel>
          No training run yet — start training in Step 3 to see evaluation
          results here.
        </EmptyPanel>
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={() => nav.goTo(3)}>
            <RotateCw className="h-4 w-4" />
            Go to Training Configuration
          </Button>
        </div>
      </div>
    )
  }

  if (
    run.status === 'SUCCEEDED' &&
    (cvPhase === 'awaiting-scoring' || cvPhase === 'scoring')
  ) {
    return (
      <div className="space-y-4">
        <EmptyPanel>
          {cvPhase === 'scoring' ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Scoring against the holdout — this refits nothing, it only scores
              the model already trained.
            </span>
          ) : (
            <>
              Cross-validation trained {run.algorithm} on {run.targetY}. The
              fold metrics (Step 4) describe the configuration — the shipped
              model has no score of its own until it is scored against the
              dataset&apos;s validation holdout.
            </>
          )}
        </EmptyPanel>
        {scoringError && <p className="text-xs text-red-500">{scoringError}</p>}
        {run.cvFolds && <CvFoldTable cvFolds={run.cvFolds} />}
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button
            onClick={() => void handleTriggerScoring()}
            disabled={cvPhase === 'scoring' || triggering}
          >
            <PlayCircle className="h-4 w-4" />
            {cvPhase === 'scoring' ? 'Scoring…' : 'Score against holdout'}
          </Button>
          <Button variant="outline" onClick={() => nav.goTo(3)}>
            <RotateCw className="h-4 w-4" />
            Retrain
          </Button>
        </div>
      </div>
    )
  }

  if (run.status !== 'SUCCEEDED' || !fit) {
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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 px-4 py-3 ring-1 ring-emerald-500/20">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
        <div>
          {/* MODEL-FLOW-019-T15/V25. Reads the SAME `population` derivation
              every chart panel below reads, rather than `cvPhase` a fifth
              time — `population === 'holdout'` and `cvPhase === 'scored'`
              are equivalent in every phase reachable here (the two early
              returns above already route `awaiting-scoring`/`scoring`
              away), so this changes which variable is read, not what
              renders. */}
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            {population === 'holdout'
              ? 'Holdout scoring complete'
              : 'Training complete'}
          </p>
          <p className="text-xs text-muted-foreground">
            {algorithmLabel} on {run.targetY} · {fit.n} {populationText} sample
            {fit.n === 1 ? '' : 's'}
          </p>
          {population === 'holdout' &&
            run.holdoutMetrics &&
            (typeof run.holdoutMetrics.dropped_unlabelled === 'number' ||
              typeof run.holdoutMetrics.dropped_bad_features === 'number') && (
              <p className="text-[11px] text-muted-foreground">
                Dropped {String(run.holdoutMetrics.dropped_unlabelled ?? 0)}{' '}
                unlabelled,{' '}
                {String(run.holdoutMetrics.dropped_bad_features ?? 0)} with bad
                features from the raw holdout before scoring.
              </p>
            )}
        </div>
      </div>

      {/* MODEL-FLOW-019-T20 follow-up. An ORDINARY (non-CV) run's own
          "Score against holdout" — the CV-specific block above (its own
          `awaiting-scoring`/`scoring` early return) cannot host this: an
          ordinary run always has `fit`/charts to show, so it never reaches
          that return, and that block's copy ("Cross-validation trained…",
          the fold table) is wrong for it anyway. Never shown once
          `holdoutPredictionsKey` is set — a scored series already exists,
          nothing left to trigger. `handleTriggerScoring`/`triggering` are
          the SAME state the CV block already uses; MODEL-FLOW-019-T20
          widened `triggerScoring` itself to any SUCCEEDED run, so no new
          request logic is needed here, only where the button is offered.

          Every sentence below stays HYPHENATED ("validation-holdout"),
          never the bare two-word phrase — the phase-3-evaluation.test.tsx
          contract this feature shipped with (MODEL-FLOW-019-T15/V25)
          asserts `/validation holdout/` appears NOWHERE on this page for a
          non-CV run's own population, which stays `test-split` here
          regardless of this block. This block names a DIFFERENT, absent
          figure — the same way Step 4's own test-split/holdout panel pair
          already uses both words on one screen without conflating them —
          but the contract greps by literal substring, not by section, so
          the hyphen is what keeps the promise textually true rather than
          only true in intent. */}
      {cvPhase === 'not-cv' && !run.holdoutPredictionsKey && (
        <div className="space-y-1.5 rounded-xl border border-dashed border-border/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-xs text-muted-foreground">
              {run.scoringContainerId
                ? 'Holdout scoring is running — this refits nothing, it only scores the model already trained.'
                : run.holdoutMetrics
                  ? "This run has a validation-holdout score, but training kept only the aggregate — the per-row series Step 4's holdout chart needs comes from scoring it again."
                  : "Not yet scored against the dataset's validation-holdout rows — scoring runs separately from training."}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleTriggerScoring()}
              disabled={Boolean(run.scoringContainerId) || triggering}
            >
              <PlayCircle className="h-4 w-4" />
              {run.scoringContainerId ? 'Scoring…' : 'Score against holdout'}
            </Button>
          </div>
          {scoringError && (
            <p className="text-xs text-red-500">{scoringError}</p>
          )}
        </div>
      )}

      {manifest?.derivedFromTarget && manifest.derivedFromTarget.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Uses {manifest.derivedFromTarget.length} target-derived feature
          {manifest.derivedFromTarget.length === 1 ? '' : 's'} not shown here —
          serving this model will need target history at inference time.
        </p>
      )}

      {/* Toolbar: compare + metric selector */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">
            Evaluation metrics
          </h2>
        </div>

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
                  selectedMetrics.length === 1 && selectedMetrics.includes(key)
                }
                onCheckedChange={on => toggleMetric(key, on)}
              >
                {METRIC_META[key].label} ({METRIC_META[key].hint})
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Metric cards */}
      <div
        className={cn(
          'grid gap-4',
          visible.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
        )}
      >
        {visible.map(key => (
          <StatTile
            key={key}
            label={METRIC_META[key].label}
            value={valueFor(key)}
            sub={METRIC_META[key].hint}
            toneClassName={accentFor(key)}
          />
        ))}
      </div>

      {hasFit &&
        (() => {
          const bias =
            residuals.reduce((sum, r) => sum + r, 0) / residuals.length
          return (
            <p className="text-[11px] text-muted-foreground">
              RMSE {fit.rmse.toFixed(3)} vs SD {fit.sd.toFixed(3)} — this
              run&apos;s bias is {bias.toFixed(3)}, the same figure the ±1 SD
              band below is centred against.
            </p>
          )
        })()}

      {/* Charts */}
      {hasFit && (
        <div className="space-y-5">
          <section className="space-y-3 rounded-xl border border-border/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  Actual vs predicted over time
                </h3>
                <p className="text-xs text-muted-foreground">
                  Measured actual against the model&apos;s own prediction on the
                  run&apos;s {populationText} rows — the prediction should track
                  actual inside the ±1 SD band. The band is ONE constant width —
                  this run&apos;s own residual SD, unchanged across the whole
                  series — a typical spread, not a bound drawn around each
                  individual point.
                </p>
              </div>
              <ChartZoomControls
                brush={zoom}
                total={rows.length}
                onChange={setZoom}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
              <ChartLegend items={AVP_LEGEND} />
            </div>
            <ActualVsPredictedChart
              rows={visibleRows}
              tickFormatter={tickFormatter}
            />
          </section>

          {parityDomain ? (
            <section className="space-y-3 rounded-xl border border-border/60 p-4">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  Predicted vs actual (parity)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Each {populationText} row as (actual, predicted) against the
                  45° identity line, both axes on one shared domain so distance
                  from the line is error at that magnitude. Fanning is
                  heteroscedastic error; curvature is unmodelled nonlinearity; a
                  cloud flatter than the line is the model compressing its range
                  toward the mean.
                </p>
              </div>
              <div className="mx-auto w-full max-w-md space-y-2">
                <ChartLegend items={PARITY_LEGEND} />
                <div className="aspect-square w-full">
                  <ParityScatterChart
                    rows={rows}
                    domain={parityDomain}
                    population={populationAxisLabel(population)}
                  />
                </div>
              </div>
            </section>
          ) : (
            <EmptyPanel>
              Parity plot: this run&apos;s prediction range wasn&apos;t
              recorded, so both axes have no shared domain to draw against.
            </EmptyPanel>
          )}

          <section className="space-y-3 rounded-xl border border-border/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  Residuals over time
                </h3>
                <p className="text-xs text-muted-foreground">
                  Residual = measured actual − the model&apos;s prediction, over
                  the run&apos;s {populationText}. A healthy fit stays inside ±1
                  SD with no drift or repeating structure; the figure on each
                  guardline is the share of residuals in that band alone,
                  counted outward from zero.
                </p>
              </div>
              <ChartZoomControls
                brush={zoom}
                total={rows.length}
                onChange={setZoom}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
              <ChartLegend items={RESIDUAL_LEGEND} />
            </div>
            <ResidualChart
              rows={visibleRows}
              sd={fit.sd}
              tickFormatter={tickFormatter}
            />
          </section>

          <section className="space-y-3 rounded-xl border border-border/60 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-foreground">
                {populationTitle(population)} residual diagnostics
              </h3>
              <p className="text-xs text-muted-foreground">
                Residuals from the run&apos;s {populationText} should be centred
                on 0 and roughly normal — a symmetric histogram and points
                hugging the Q-Q diagonal indicate an unbiased, well-behaved fit.
                Computed over the FULL {populationText}, not the zoom window
                above — a distribution over a hand-picked slice would be a
                weaker claim than the run&apos;s own.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2 rounded-lg border border-border/60 bg-card p-3">
                <p className="text-xs font-medium text-foreground">
                  Residual Distribution — {populationText}
                </p>
                <ResidualHistogramChart bins={histogramBins} />
              </div>
              <div className="space-y-2 rounded-lg border border-border/60 bg-card p-3">
                <p className="text-xs font-medium text-foreground">
                  Q-Q Plot (Normal)
                </p>
                <QQPlotChart points={qq.points} domain={qq.domain} />
              </div>
            </div>
          </section>
        </div>
      )}

      {run.featureImportance ? (
        <FeatureImportanceTable
          importance={run.featureImportance}
          derivedFromTarget={manifest?.derivedFromTarget ?? null}
          distinctLabelledValues={distinctLabelled.value}
          distinctLabelledSource={distinctLabelled.source}
          distinctLabelledLoading={distinctLabelled.loading}
        />
      ) : (
        <EmptyPanel>
          Feature importance: not recorded for this run — either it predates
          feature-importance recording, or {algorithmLabel} has no such quantity
          to read.
        </EmptyPanel>
      )}

      {cvPhase === 'scored' && run.cvFolds && (
        <CvFoldTable cvFolds={run.cvFolds} />
      )}

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
