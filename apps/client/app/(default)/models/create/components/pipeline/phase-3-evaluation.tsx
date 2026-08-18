'use client'

import { useMemo, useState } from 'react'
import { useAtom } from 'jotai'
import {
  CheckCircle2,
  GitCompareArrows,
  Pencil,
  RotateCw,
  SlidersHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { toModelReady } from '@/lib/preprocessing'
import {
  materializeDataset,
  materializeFromVersion,
} from '@/lib/pipeline-config'
import { useDatasetVersionRows } from '@/hooks/dataset/use-dataset-version-rows'
import { SyntheticDataBanner } from '@/components/synthetic-data-banner'
import type { PipelineConfig } from '@/lib/pipeline-config'
import {
  buildFitRows,
  computeFit,
  METRIC_KEYS,
  METRIC_META,
  type MetricKey,
  type FitPoint,
} from '@/lib/model-metrics'
import { pickTimeFormat, type BrushWindow } from '@/lib/monitoring'
import { mpSelectedMetricsAtom } from '@/store/model-pipeline'
import { useAllModels } from '@/hooks/use-all-models'
import { ChartZoomControls } from '@/components/charts/chart-zoom-controls'
import { residualHistogram, qqPoints } from '@/lib/model-evaluation'
import { StatTile } from '../stat-tile'
import { ActualVsPredictedChart } from './evaluation/actual-vs-predicted-chart'
import { ResidualChart } from './evaluation/residual-chart'
import { ResidualHistogramChart } from './evaluation/residual-histogram-chart'
import { QQPlotChart } from './evaluation/qq-plot-chart'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

interface Props {
  nav: UsePipelineNavResult
}

/** Deterministic [-1,1) noise from a string seed + index (stable across renders). */
function seededNoise(seed: string, i: number): number {
  let h = 2166136261
  const s = `${seed}:${i}`
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) / 0xffffffff) * 2 - 1
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

export function Phase3Evaluation({ nav }: Props) {
  const { selectedDataset, targetVariables } = nav
  const [selectedMetrics, setSelectedMetrics] = useAtom(mpSelectedMetricsAtom)
  const [compareId, setCompareId] = useState<string | null>(null)
  const models = useAllModels().models ?? []

  // Real rows from the dataset's committed RAW artifact when one exists; falls
  // back to synthetic rows for legacy recipes, with `rowSource` saying which.
  const { dataset: storedRaw, source: rowSource } = useDatasetVersionRows(
    selectedDataset,
    { materialize: false },
  )

  const modelReady = useMemo(() => {
    if (!selectedDataset) return { tags: [], rows: [] }
    const config = selectedDataset.pipelineConfig as PipelineConfig
    // Same recipe either way — only the raw rows it runs over differ. While the
    // stored rows load, `storedRaw` is null and this falls through to the
    // synthetic path, so the step renders immediately and swaps to real data
    // when it arrives. That keeps the four-step flow free of a loading screen
    // it never had (CLAUDE.md §7).
    return toModelReady(
      storedRaw
        ? materializeFromVersion(storedRaw, config)
        : materializeDataset(selectedDataset.tags, config),
    )
  }, [selectedDataset, storedRaw])

  const pair = useMemo(() => {
    const target = targetVariables[0]
    if (!target) return null
    const xTag = modelReady.tags.find(t => t !== target)
    return xTag ? { xTag, yTag: target } : null
  }, [modelReady.tags, targetVariables])

  const fit = useMemo(
    () => (pair ? computeFit(modelReady, pair.xTag, pair.yTag) : null),
    [modelReady, pair],
  )

  const compareModel = models.find(m => m.id === compareId) ?? null

  // Compared model's series — deterministic mock proxy derived from the current
  // fit + the model id (real per-model predictions arrive with the training
  // backend, Phase 6). Predicted is nudged within the residual SD.
  const comparePoints = useMemo<FitPoint[] | null>(() => {
    if (!fit || !compareModel || fit.points.length === 0) return null
    return fit.points.map((p, i) => {
      const predicted = p.predicted + seededNoise(compareModel.id, i) * fit.sd
      return {
        timestamp: p.timestamp,
        actual: p.actual,
        predicted,
        residual: p.actual - predicted,
      }
    })
  }, [fit, compareModel])

  const compareFit = useMemo(() => {
    if (!comparePoints) return null
    const n = comparePoints.length
    const res = comparePoints.map(p => p.residual)
    const mean = res.reduce((a, b) => a + b, 0) / n
    const rmse = Math.sqrt(res.reduce((a, b) => a + b * b, 0) / n)
    const sd = Math.sqrt(
      res.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n,
    )
    const ssRes = res.reduce((a, b) => a + b * b, 0)
    const meanY = comparePoints.reduce((a, b) => a + b.actual, 0) / n
    const ssTot = comparePoints.reduce(
      (a, b) => a + (b.actual - meanY) * (b.actual - meanY),
      0,
    )
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot
    return { r2, rmse, sd }
  }, [comparePoints])

  // Chart rows: one per timestamp, carrying the ±1/±2/±3 SD bands (true
  // residual SD) plus the compared model's series on the same rows.
  const rows = useMemo(
    () => (fit ? buildFitRows(fit.points, fit.sd, comparePoints) : []),
    [fit, comparePoints],
  )

  // Residual diagnostics (histogram + Q-Q) — computed over the full fit, not the
  // zoom window, so the distribution reflects every validation sample.
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
  const otherModels = models.filter(m => m.id !== compareId)
  const hasFit = Boolean(pair && fit && fit.n >= 2)

  return (
    <div className="space-y-5">
      {/* Ahead of the metrics, deliberately: this is the screen where believing
          simulated numbers is most costly — someone could judge a model on
          them. */}
      {rowSource === 'synthetic' && (
        <SyntheticDataBanner reason="This dataset has no stored rows to evaluate against." />
      )}

      {/* Success banner */}
      <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 px-4 py-3 ring-1 ring-emerald-500/20">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
        <div>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            Training complete
          </p>
          <p className="text-xs text-muted-foreground">
            {pair
              ? `Fit on ${pair.yTag} vs ${pair.xTag} · ${fit?.n ?? 0} samples`
              : 'Select a target variable to evaluate a fit.'}
          </p>
        </div>
      </div>

      {/* Toolbar: compare + metric selector */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">
            Evaluation metrics
          </h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="w-fit gap-2">
                <GitCompareArrows className="h-3.5 w-3.5" />
                {compareModel ? `vs ${compareModel.name}` : 'Compare with…'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-72 w-full overflow-y-auto"
            >
              <DropdownMenuLabel>Compare with another model</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {compareModel && (
                <DropdownMenuItem onClick={() => setCompareId(null)}>
                  Clear comparison
                </DropdownMenuItem>
              )}
              {otherModels.length === 0 ? (
                <DropdownMenuItem disabled>No other models</DropdownMenuItem>
              ) : (
                otherModels.map(m => (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={() => setCompareId(m.id)}
                    className="flex items-start justify-between gap-4"
                  >
                    <span className="flex-1 wrap-break-word">{m.name}</span>

                    <span className="w-20 shrink-0 text-left text-xs text-muted-foreground mt-0.5">
                      {m.workspaceName}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
            sub={
              compareFit
                ? `vs ${METRIC_META[key].format(compareFit[key])}`
                : METRIC_META[key].hint
            }
            toneClassName={accentFor(key)}
          />
        ))}
      </div>

      {/* Charts */}
      {hasFit && fit && (
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
              {compareModel && (
                <LegendItem color="var(--chart-4)" label={compareModel.name} />
              )}
            </div>
            <ActualVsPredictedChart
              rows={visibleRows}
              tickFormatter={tickFormatter}
              compareName={compareModel?.name}
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
              {compareModel && (
                <LegendItem color="var(--chart-4)" label={compareModel.name} />
              )}
            </div>
            <ResidualChart
              rows={visibleRows}
              sd={fit.sd}
              tickFormatter={tickFormatter}
              compareName={compareModel?.name}
            />
          </section>

          {/* Validation residual diagnostics — distribution + normality */}
          <section className="space-y-3 rounded-xl border border-border/60 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-foreground">
                Validation residual diagnostics
              </h3>
              <p className="text-xs text-muted-foreground">
                Residuals should be centred on 0 and roughly normal — a
                symmetric histogram and points hugging the Q-Q diagonal indicate
                an unbiased, well-behaved fit.
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

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
        <Button variant="outline" onClick={() => nav.goTo(2)}>
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
