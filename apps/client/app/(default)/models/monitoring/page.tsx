'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import { useAllModels } from '@/hooks/use-all-models'
import { useMonitoringData } from '@/hooks/model/use-monitoring-data'
import type { TimeRange } from '@/lib/mock-readings'
import {
  buildMonitoringRows,
  pickTimeFormat,
  windowStats,
  type BrushWindow,
} from '@/lib/monitoring'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ChartZoomControls } from '@/components/charts/chart-zoom-controls'
import { MonitoringToolbar } from './components/monitoring-toolbar'
import { ActualVsPredictChart } from './components/actual-vs-predict-chart'
import { ResidualChart, type ResidualMode } from './components/residual-chart'

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

export default function AdvancedModelMonitoring() {
  const { models } = useAllModels()
  const [selectedId, setSelectedId] = useState('')
  const [range, setRange] = useState<TimeRange>('24h')
  const [brush, setBrush] = useState<BrushWindow>({})
  const [residualMode, setResidualMode] = useState<ResidualMode>('abs')

  useEffect(() => {
    const first = models?.[0]
    if (!selectedId && first) setSelectedId(first.id)
  }, [models, selectedId])

  const model = useMemo(
    () => models?.find(m => m.id === selectedId) ?? null,
    [models, selectedId],
  )
  const { points, tag } = useMonitoringData(model, range)

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

  if (models !== null && models.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Activity className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No models yet</p>
        <p className="text-sm text-muted-foreground">
          Create and deploy a model to monitor its predictions here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-5 p-4 lg:p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">
          Model Monitoring
        </h1>
        <p className="text-sm text-muted-foreground">
          Actual vs. Predicted with 3-layer SD guardrails and residual analysis.
        </p>
      </div>
      <MonitoringToolbar
        models={models ?? []}
        selectedId={selectedId}
        onSelectModel={setSelectedId}
        range={range}
        onRange={changeRange}
        rmse={stats.rmse}
        tag={tag}
      />
      {/* Top chart — Actual vs Predict */}
      <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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
    </div>
  )
}
