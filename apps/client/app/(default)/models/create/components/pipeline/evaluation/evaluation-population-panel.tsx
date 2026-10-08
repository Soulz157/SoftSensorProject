'use client'

import { useMemo, useState } from 'react'
import { Loader2, PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  buildFitRows,
  METRIC_KEYS,
  METRIC_META,
  type MetricKey,
} from '@/lib/model-metrics'
import { pickTimeFormat, type BrushWindow } from '@/lib/monitoring'
import { residualHistogram, qqPoints } from '@/lib/model-evaluation'
import {
  populationAxisLabel,
  populationLabel,
  populationTitle,
} from '@/lib/metric-source'
import { foldCutXs } from '@/lib/cv-oof'
import type {
  PopulationAbsence,
  PopulationEvaluation,
} from '@/hooks/model/use-draft-run-evaluation'
import type { CvFoldRecord } from '@/services/model-draft'
import { ChartZoomControls } from '@/components/charts/chart-zoom-controls'
import { ChartLegend } from '@/components/charts/chart-legend'
import { StatTile } from '../../stat-tile'
import { ActualVsPredictedChart, AVP_LEGEND } from './actual-vs-predicted-chart'
import { ParityScatterChart, PARITY_LEGEND } from './parity-scatter-chart'
import { ResidualChart, RESIDUAL_LEGEND } from './residual-chart'
import { ResidualHistogramChart } from './residual-histogram-chart'
import { QQPlotChart } from './qq-plot-chart'
import { EmptyPanel } from './empty-panel'

/** What the panel needs to offer "Score against holdout". Only the holdout
 *  tab is ever given one. */
export interface ScoringAction {
  /** Why scoring cannot be offered at all (sequence model), else null. */
  unavailableReason: string | null
  scoring: boolean
  triggering: boolean
  error: string | null
  onScore: () => void
}

interface Props {
  evaluation: PopulationEvaluation
  /** The metrics the user has switched on in the toolbar. */
  visibleMetrics: MetricKey[]
  /** A CV run's folds — draws the boundaries on the out-of-fold chart and
   *  names how many folds the tiles average. */
  cvFolds: { folds: CvFoldRecord[]; n_splits: number } | null
  /** Caption lines the page owns because only it knows the run (e.g. the
   *  holdout's dropped-row counts). Rendered under the sample count. */
  note?: React.ReactNode
  scoringAction?: ScoringAction
}

function absenceText(
  absence: PopulationAbsence,
  evaluation: PopulationEvaluation,
  scoringAction: ScoringAction | undefined,
): string {
  const isHoldout = evaluation.population === 'holdout'
  switch (absence) {
    case 'no-oof':
      return (
        'No out-of-fold predictions are stored for this run — runs trained ' +
        'before they were saved have none. Retrain to see this chart. The ' +
        'fold figures above are unaffected.'
      )
    case 'too-large':
      return (
        `This ${populationLabel(evaluation.population)} series is too large to ` +
        'draw. It is not sampled down: a histogram or Q-Q plot of a sample ' +
        'would not describe the population it is captioned with.'
      )
    case 'unreadable':
      return `The ${populationLabel(evaluation.population)} predictions are recorded but could not be read.`
    case 'no-series':
    default:
      if (!isHoldout) {
        return 'This run recorded no scores for its own population.'
      }
      if (scoringAction?.scoring) {
        return 'Holdout scoring is running — this refits nothing, it only scores the model already trained.'
      }
      if (scoringAction?.unavailableReason) {
        return scoringAction.unavailableReason
      }
      return evaluation.metrics
        ? 'The scored figures above are recorded, but no per-row series was kept — either this run predates keeping it, or its scoring could not produce one. Scoring again produces it.'
        : 'Not yet scored against the dataset’s validation holdout. Scoring produces the figures and the charts below.'
  }
}

/**
 * MODEL-FLOW-030. ONE population's Evaluation: the metric tiles, Actual vs
 * Predicted, parity, residuals and the distribution diagnostics. Step 5 renders
 * one of these per tab, so a run's own population and its validation holdout
 * look identical and each owns its zoom window.
 *
 * Every word in here comes from `evaluation.population` — a panel never names
 * another population's (MODEL-FLOW-019).
 *
 * Tiles come from `evaluation.metrics`, so they survive a missing series (most
 * runs have holdout figures and no holdout series). For the out-of-fold
 * population they are the fold MEAN ± std; the SD tile and every diagnostic
 * below come from the POOLED out-of-fold series, whose RMSE is a different
 * number from the fold mean — the tile says so rather than leave two RMSE-like
 * figures to disagree.
 */
export function EvaluationPopulationPanel({
  evaluation,
  visibleMetrics,
  cvFolds,
  note,
  scoringAction,
}: Props) {
  const { population, metrics, fit, parityRange, absence } = evaluation
  const isOof = population === 'cv-oof'
  const populationText = populationLabel(population)

  const rows = useMemo(
    () => (fit ? buildFitRows(fit.points, fit.sd) : []),
    [fit],
  )
  const residuals = useMemo(
    () => (fit ? fit.points.map(p => p.residual) : []),
    [fit],
  )
  const histogramBins = useMemo(() => residualHistogram(residuals), [residuals])
  const qq = useMemo(() => qqPoints(residuals), [residuals])
  const foldCuts = useMemo(
    () => (isOof && cvFolds ? foldCutXs(cvFolds.folds) : undefined),
    [isOof, cvFolds],
  )

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

  const parityDomain = useMemo<[number, number] | null>(() => {
    if (!parityRange) return null
    return [
      Math.min(parityRange.yTrueMin, parityRange.yPredMin),
      Math.max(parityRange.yTrueMax, parityRange.yPredMax),
    ]
  }, [parityRange])

  const hasFit = Boolean(fit && fit.points.length >= 2)

  // The caption's RMSE must be the same population as its SD and bias. For the
  // out-of-fold series `fit.rmse` is the fold MEAN (the tile's figure), which
  // does not satisfy RMSE² ≈ SD² + bias² — so the caption recomputes RMSE from
  // the pooled residuals it is comparing against.
  const captionRmse = useMemo(() => {
    if (!fit) return null
    if (!isOof) return fit.rmse
    if (residuals.length === 0) return null
    return Math.sqrt(
      residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length,
    )
  }, [fit, isOof, residuals])

  const valueFor = (key: MetricKey): string => {
    if (key === 'sd') return fit && fit.n >= 2 ? fit.sd.toFixed(3) : '—'
    if (!metrics) return '—'
    const mean = metrics[key]
    const std = metrics.std?.[key]
    return std !== undefined && isOof
      ? `${mean.toFixed(3)} ± ${std.toFixed(3)}`
      : mean.toFixed(3)
  }
  const accentFor = (key: MetricKey): string | undefined => {
    if (key === 'sd' || !metrics) return undefined
    return METRIC_META[key].accent?.(metrics[key])
  }
  const subFor = (key: MetricKey): string => {
    if (isOof && key === 'sd') return 'pooled out-of-fold residual SD'
    if (isOof && metrics?.std) {
      return `mean ± std across ${metrics.nSplits ?? cvFolds?.n_splits ?? 'k'} folds`
    }
    return METRIC_META[key].hint
  }

  const tiles = METRIC_KEYS.filter(k => visibleMetrics.includes(k))

  return (
    <div className="space-y-5">
      {fit && (
        <p className="text-xs text-muted-foreground">
          {fit.n} {populationText} sample{fit.n === 1 ? '' : 's'}
          {isOof && cvFolds ? ` across ${cvFolds.n_splits} folds` : ''}
        </p>
      )}
      {note}

      {tiles.length > 0 && (
        <div
          className={cn(
            'grid gap-4',
            tiles.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
          )}
        >
          {tiles.map(key => (
            <StatTile
              key={key}
              label={METRIC_META[key].label}
              value={valueFor(key)}
              sub={subFor(key)}
              toneClassName={accentFor(key)}
            />
          ))}
        </div>
      )}

      {!hasFit && (
        <div className="space-y-2">
          <EmptyPanel>
            {scoringAction?.scoring ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {absenceText(absence ?? 'no-series', evaluation, scoringAction)}
              </span>
            ) : (
              absenceText(absence ?? 'no-series', evaluation, scoringAction)
            )}
          </EmptyPanel>
          {/* Only when scoring could actually produce the missing series. A
              series that is too large or unreadable is not fixed by another
              scoring container — offering one would just spend a run. */}
          {scoringAction &&
            !scoringAction.unavailableReason &&
            (absence === null || absence === 'no-series') && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={scoringAction.onScore}
                  disabled={scoringAction.scoring || scoringAction.triggering}
                >
                  <PlayCircle className="h-4 w-4" />
                  {scoringAction.scoring ? 'Scoring…' : 'Score against holdout'}
                </Button>
                {scoringAction.error && (
                  <p className="text-xs text-red-500">{scoringAction.error}</p>
                )}
              </div>
            )}
        </div>
      )}

      {fit && hasFit && (
        <>
          <p className="text-[11px] text-muted-foreground">
            {isOof
              ? 'Each fold’s model predicting rows it never trained on — these describe the configuration, not the refit that gets saved. '
              : ''}
            {isOof ? 'Pooled out-of-fold RMSE' : 'RMSE'}{' '}
            {(captionRmse ?? fit.rmse).toFixed(3)} vs SD {fit.sd.toFixed(3)} —
            this population&apos;s bias is{' '}
            {(
              residuals.reduce((sum, r) => sum + r, 0) / residuals.length
            ).toFixed(3)}
            , the same figure the ±1 SD band below is centred against.
          </p>

          <div className="space-y-5">
            <section className="space-y-3 rounded-xl border border-border/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-foreground">
                    Actual vs predicted over time
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Measured actual against the model&apos;s own prediction on
                    the run&apos;s {populationText} rows — the prediction should
                    track actual inside the ±1 SD band. The band is ONE constant
                    width — this population&apos;s own residual SD, unchanged
                    across the whole series — a typical spread, not a bound
                    drawn around each individual point.
                    {isOof
                      ? ' Dashed vertical lines mark where each fold’s test window begins.'
                      : ''}
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
                foldCuts={foldCuts}
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
                    45° identity line, both axes on one shared domain so
                    distance from the line is error at that magnitude. Fanning
                    is heteroscedastic error; curvature is unmodelled
                    nonlinearity; a cloud flatter than the line is the model
                    compressing its range toward the mean.
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
                Parity plot: this population&apos;s prediction range wasn&apos;t
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
                    Residual = measured actual − the model&apos;s prediction,
                    over the run&apos;s {populationText} rows. A healthy fit
                    stays inside ±1 SD with no drift or repeating structure; the
                    figure on each guardline is the share of residuals in that
                    band alone, counted outward from zero.
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
                  Residuals from the run&apos;s {populationText} rows should be
                  centred on 0 and roughly normal — a symmetric histogram and
                  points hugging the Q-Q diagonal indicate an unbiased,
                  well-behaved fit. Computed over the FULL {populationText}{' '}
                  series, not the zoom window above — a distribution over a
                  hand-picked slice would be a weaker claim than the
                  population&apos;s own.
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
        </>
      )}
    </div>
  )
}
