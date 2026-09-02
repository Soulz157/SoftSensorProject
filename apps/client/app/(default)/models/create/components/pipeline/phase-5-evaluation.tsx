'use client'

import { useMemo, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  AlertTriangle,
  CheckCircle2,
  GitCompareArrows,
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
import { ChartZoomControls } from '@/components/charts/chart-zoom-controls'
import { residualHistogram, qqPoints } from '@/lib/model-evaluation'
import type { RunCvFolds } from '@/services/model-draft'
import { StatTile } from '../stat-tile'
import { ActualVsPredictedChart } from './evaluation/actual-vs-predicted-chart'
import { ResidualChart } from './evaluation/residual-chart'
import { ResidualHistogramChart } from './evaluation/residual-histogram-chart'
import { QQPlotChart } from './evaluation/qq-plot-chart'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

interface Props {
  nav: UsePipelineNavResult
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * MODEL-FLOW-016-T11. The REAL per-fold table — post-training r2/rmse/mae
 * beside each fold's own row counts, distinct from T10's `CvFoldPlan`
 * (Step 3's pre-training `/split-stats` plan; same row counts, no metrics
 * yet, because training had not run). Available as soon as `cvFoldsKey` is
 * set — training writes `cv_folds.json` before scoring exists as a
 * concept — so this renders in the awaiting-scoring/scoring state too, not
 * only once the model is scored: it is how a reader spots the fold that
 * looks worst, which is the whole reason to still trust (or not) the
 * configuration while its refit is waiting to be scored.
 */
function CvFoldTable({ cvFolds }: { cvFolds: RunCvFolds }) {
  return (
    <section className="space-y-3 rounded-xl border border-border/60 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">
          Per-fold configuration metrics
        </h3>
        <p className="text-xs text-muted-foreground">
          {cvFolds.n_splits} expanding fold{cvFolds.n_splits === 1 ? '' : 's'} —
          the configuration&apos;s own numbers, never the shipped model&apos;s
          score above. A fold far worse than its neighbours is a real finding,
          not noise.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Fold</th>
              <th className="px-3 py-2 font-medium">Cut</th>
              <th className="px-3 py-2 font-medium text-right">Train rows</th>
              <th className="px-3 py-2 font-medium text-right">Test rows</th>
              <th className="px-3 py-2 font-medium text-right">R²</th>
              <th className="px-3 py-2 font-medium text-right">RMSE</th>
              <th className="px-3 py-2 font-medium text-right">MAE</th>
            </tr>
          </thead>
          <tbody>
            {cvFolds.folds.map(fold => (
              <tr
                key={fold.fold}
                className={fold.fold > 1 ? 'border-t border-border' : undefined}
              >
                <td className="px-3 py-2 font-medium text-foreground">
                  {fold.fold}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {new Date(fold.cut_timestamp).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fold.train_rows.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fold.test_rows.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fold.r2.toFixed(3)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fold.rmse.toFixed(3)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fold.mae.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * MODEL-FLOW-004. Reads the Model Draft's own training run — no persistent
 * Model record, no client-side fit. `r2`/`rmse` come from the run's own
 * metrics.json; the per-sample actual/predicted series and residual SD are
 * computed server-side over the run's FULL test split (no decimation
 * branch — see `useDraftRunEvaluation`), so the metric cards, both charts
 * and the diagnostics below always agree on sample count.
 */
export function Phase5Evaluation({ nav }: Props) {
  const [selectedMetrics, setSelectedMetrics] = useAtom(mpSelectedMetricsAtom)
  const serverDraftId = useAtomValue(mpServerDraftIdAtom)
  const trainingResult = useAtomValue(mpTrainingResultAtom)

  const { run, fit, manifest, loading, error, triggerScoring } =
    useDraftRunEvaluation(serverDraftId, trainingResult?.runId ?? null)
  const cvPhase = cvScoringPhaseOf(run)
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

  // Chart rows: one per timestamp, carrying the ±1/±2/±3 SD bands (true
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

  const valueFor = (key: MetricKey): string => {
    if (!fit || fit.n < 2) return '—'
    return METRIC_META[key].format(fit[key])
  }
  const accentFor = (key: MetricKey): string | undefined => {
    if (!fit || fit.n < 2) return undefined
    return METRIC_META[key].accent?.(fit[key])
  }

  const toggleMetric = (key: MetricKey, on: boolean) => {
    setSelectedMetrics(prev =>
      on
        ? METRIC_KEYS.filter(k => prev.includes(k) || k === key)
        : prev.filter(k => k !== key),
    )
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

  // MODEL-FLOW-016-T11. A CV run's training success and its refit's OWN
  // holdout score are two different questions — the fold metrics in
  // cv_folds.json describe the CONFIGURATION (see Step 4), not this
  // shipped model. This branch must come before the generic
  // "still running" one below: a SUCCEEDED CV run with no `fit` yet is not
  // running, it is honestly awaiting a scoring phase the user triggers.
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
      {/* Success banner — the run's own record, not a client-side count.
          A scored CV run's `fit.n` counts HOLDOUT rows, not a test split —
          say so, never "test sample", so this isn't misread as the split
          this run never had (three numbers, three meanings, never merged). */}
      <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 px-4 py-3 ring-1 ring-emerald-500/20">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
        <div>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            {cvPhase === 'scored'
              ? 'Holdout scoring complete'
              : 'Training complete'}
          </p>
          <p className="text-xs text-muted-foreground">
            {algorithmLabel} on {run.targetY} ·{' '}
            {cvPhase === 'scored'
              ? `${fit.n} holdout sample${fit.n === 1 ? '' : 's'}`
              : `${fit.n} test sample${fit.n === 1 ? '' : 's'}`}
          </p>
          {/* DS-LAKE-018-T05: the holdout's own missing rate stated beside
              every figure it backs — raw rows reach `predict()` unimputed,
              so a reader must be able to tell how many were dropped before
              trusting the numbers above. */}
          {cvPhase === 'scored' &&
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
          {/* Disabled, not removed: no saved Model can supply a real
              predicted series to compare against yet — MODEL-FLOW-007
              adopts a run's predictions by pointer, which is what this
              needs. Same disable-with-reason precedent as AlgorithmSelector's
              lstm/gru entries. */}
          <Button
            variant="outline"
            size="sm"
            className="w-fit gap-2"
            disabled
            title="Compares against another model's real predictions — available once Save Model can adopt a run (MODEL-FLOW-007)."
          >
            <GitCompareArrows className="h-3.5 w-3.5" />
            Compare with…
          </Button>
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
            {METRIC_KEYS.map(key => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={selectedMetrics.includes(key)}
                disabled={
                  selectedMetrics.length === 1 && selectedMetrics.includes(key)
                }
                onCheckedChange={on => toggleMetric(key, on)}
              >
                {METRIC_META[key].label} — {METRIC_META[key].hint}
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

      {/* Charts */}
      {hasFit && (
        <div className="space-y-5">
          <section className="space-y-3 rounded-xl border border-border/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  Actual vs Predicted
                </h3>
                <p className="text-xs text-muted-foreground">
                  The prediction should track actual within the ±1 SD band;
                  excursions are the samples the fit explains worst.
                </p>
              </div>
              <ChartZoomControls
                brush={zoom}
                total={rows.length}
                onChange={setZoom}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
              <LegendItem color="var(--foreground)" label="Actual" />
              <LegendItem color="var(--chart-1)" label="Predicted" />
              <LegendItem color="var(--chart-2)" label="±1 SD" />
            </div>
            <ActualVsPredictedChart
              rows={visibleRows}
              tickFormatter={tickFormatter}
            />
          </section>

          <section className="space-y-3 rounded-xl border border-border/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  Residuals
                </h3>
                <p className="text-xs text-muted-foreground">
                  Residual = Actual − Predicted. A healthy fit stays inside ±1
                  SD with no drift or repeating structure.
                </p>
              </div>
              <ChartZoomControls
                brush={zoom}
                total={rows.length}
                onChange={setZoom}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
              <LegendItem color="var(--chart-1)" label="Residual" />
              <LegendItem color="var(--chart-2)" label="±1 SD" />
              <LegendItem color="var(--chart-3)" label="±2 SD" />
              <LegendItem color="var(--destructive)" label="±3 SD" />
            </div>
            <ResidualChart
              rows={visibleRows}
              sd={fit.sd}
              tickFormatter={tickFormatter}
            />
          </section>

          {/* Distribution + normality over the run's TEST split for an
              ordinary run — MODEL-FLOW-016-T11: for a scored CV run, `fit`
              is instead the raw validation holdout no fit ever saw, so the
              heading/copy below say so rather than naming a test split this
              run never had. */}
          <section className="space-y-3 rounded-xl border border-border/60 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-foreground">
                {cvPhase === 'scored'
                  ? 'Holdout residual diagnostics'
                  : 'Test-split residual diagnostics'}
              </h3>
              <p className="text-xs text-muted-foreground">
                {cvPhase === 'scored'
                  ? "Residuals from the model's validation holdout should be"
                  : "Residuals from the run's held-out test rows should be"}{' '}
                centred on 0 and roughly normal — a symmetric histogram and
                points hugging the Q-Q diagonal indicate an unbiased,
                well-behaved fit.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2 rounded-lg border border-border/60 bg-card p-3">
                <p className="text-xs font-medium text-foreground">
                  Residual Distribution
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
