'use client'

import { useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import type { AIModel } from '@/types'
import { useMonitoringData } from '@/hooks/model/use-monitoring-data'
import { usePredictionMonitoring } from '@/hooks/model/use-prediction-monitoring'
import type { TimeRange } from '@/lib/mock-readings'
import {
  buildMonitoringRows,
  pickTimeFormat,
  windowStats,
  type BrushWindow,
} from '@/lib/monitoring'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ChartZoomControls } from '@/components/charts/chart-zoom-controls'
import { MonitoringRangeBar } from './monitoring-range-bar'
import { ActualVsPredictChart } from './actual-vs-predict-chart'
import { ResidualChart, type ResidualMode } from './residual-chart'
import { LivePredictionChart } from './live-prediction-chart'
import { DriftPanel } from './drift-panel'

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

interface Props {
  model: AIModel
}

/**
 * Monitoring tab on the Model detail page — moved from the standalone
 * `/models/monitoring` route (which carried its own model picker; `[id]`
 * already resolved the model, so that picker and its empty state are gone).
 *
 * Two real-data sections (Live Predictions, Distribution Drift — see
 * MODEL-SERVE-005) and two simulated sections (Actual vs. Predict, Residual
 * Analysis — `useMonitoringData` reads the mock lab layer; ground truth
 * does not exist anywhere in this system yet, MODEL-SERVE-005-T03 is
 * blocked, so these are never wired to fabricate an `actual` value). The
 * simulated section is labelled as such rather than left to read as
 * authoritative.
 */
export function ModelMonitoringTab({ model }: Props) {
  const [range, setRange] = useState<TimeRange>('24h')
  const [brush, setBrush] = useState<BrushWindow>({})
  const [residualMode, setResidualMode] = useState<ResidualMode>('abs')

  const { points, tag } = useMonitoringData(model, range)
  const {
    points: livePoints,
    pointsLoading: livePointsLoading,
    drift,
    driftLoading,
    driftUnavailableReason,
  } = usePredictionMonitoring(model, range)

  const start = brush.startIndex ?? 0
  const end = brush.endIndex ?? Math.max(0, points.length - 1)
  const visible = useMemo(
    () => points.slice(start, end + 1),
    [points, start, end],
  )
  const stats = useMemo(() => windowStats(visible), [visible])

  const rows = useMemo(
    () => buildMonitoringRows(points, stats.sd),
    [points, stats.sd],
  )
  const tickFormatter = useMemo(() => {
    const first = visible[0]
    const last = visible[visible.length - 1]
    const spanMs =
      first && last
        ? Date.parse(last.timestamp) - Date.parse(first.timestamp)
        : 0
    return pickTimeFormat(spanMs)
  }, [visible])

  const yDomain = useMemo<[number, number]>(() => {
    const values = rows.flatMap(r =>
      [r.actual, r.predict].filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v),
      ),
    )
    if (values.length === 0) return [0, 1]

    const lo = Math.min(...values)
    const hi = Math.max(...values)

    // Guarantee the band is on screen even when actual and predict track each
    // other almost exactly — otherwise a very good model produces a
    // zero-height domain and nothing renders at all.
    const bandSpan = stats.sd * 2
    const dataSpan = hi - lo
    const span = Math.max(dataSpan, bandSpan * 3)
    const pad = span * 0.12
    const mid = (lo + hi) / 2

    return [mid - span / 2 - pad, mid + span / 2 + pad]
  }, [rows, stats.sd])

  const changeRange = (r: TimeRange) => {
    setRange(r)
    setBrush({})
  }

  return (
    <div className="flex flex-col gap-5">
      <MonitoringRangeBar
        range={range}
        onRange={changeRange}
        rmse={stats.rmse}
        tag={tag}
      />
      {/* Top chart — Actual vs Predict */}
      <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            Actual vs. Predict (3-Layer SD Guardrails)
          </h2>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
            <LegendItem color="var(--foreground)" label="Actual" />
            <LegendItem color="var(--chart-1)" label="Predict" />
            <LegendItem color="var(--chart-2)" label="±1 SD" />
            {/* <LegendItem color="var(--chart-3)" label="±2 SD" />
            <LegendItem color="var(--destructive)" label="±3 SD" /> */}
          </div>
          <ChartZoomControls
            brush={brush}
            total={points.length}
            onChange={setBrush}
          />
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Simulated pending the ground-truth join — no measured actual value
          exists for this model yet.
        </p>

        <div className="max-h-full flex-1">
          <ActualVsPredictChart
            rows={rows}
            brush={brush}
            onBrush={setBrush}
            tickFormatter={tickFormatter}
            yDomain={yDomain}
          />
        </div>
      </div>
      <div className="flex min-h-70 flex-col rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Activity className="h-4 w-4 text-chart-5" />
            Residual Analysis (Actual − Predict)
          </h2>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
            <LegendItem color="var(--foreground)" label="Actual" />
            <LegendItem color="var(--chart-1)" label="Predict" />
            <LegendItem color="var(--chart-2)" label="±1 SD" />
            <LegendItem color="var(--chart-3)" label="±2 SD" />
            <LegendItem color="var(--destructive)" label="±3 SD" />
          </div>
          <ToggleGroup
            type="single"
            value={residualMode}
            onValueChange={v => v && setResidualMode(v as ResidualMode)}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="abs" className="px-3">
              Absolute
            </ToggleGroupItem>
            <ToggleGroupItem value="pct" className="px-3">
              Percent
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="min-h-0 flex-1">
          <ResidualChart
            rows={rows}
            brush={brush}
            onBrush={setBrush}
            tickFormatter={tickFormatter}
            sd={stats.sd}
            mode={residualMode}
          />
        </div>
      </div>

      {/* MODEL-SERVE-005. Real data — the sampled synchronous-/predict
          stream and the drift signal built on it. Separate from the charts
          above: those depend on ground truth this system does not have yet
          (T03 is blocked), so this section never fabricates an "actual". */}
      <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
        <div className="mb-4 space-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            Live Predictions (sampled)
          </h2>
          <p className="text-xs text-muted-foreground">
            The actual synchronous /predict stream — no ground truth is joined
            yet, so no actual/residual is shown here.
          </p>
        </div>
        {livePointsLoading ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : (
          <LivePredictionChart points={livePoints} />
        )}
      </div>

      <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
        <div className="mb-4 space-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            Distribution Drift
          </h2>
          <p className="text-xs text-muted-foreground">
            Live inputs vs. the production version&apos;s own training
            distribution (column_stats.json).
          </p>
        </div>
        <DriftPanel
          report={drift}
          loading={driftLoading}
          unavailableReason={driftUnavailableReason}
        />
      </div>
    </div>
  )
}
