'use client'

import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Brush,
  ResponsiveContainer,
  ReferenceArea,
} from 'recharts'
import type { BrushWindow, MonitoringRow } from '@/lib/monitoring'
import { MonitoringTooltip } from './monitoring-tooltip'
import { useMemo } from 'react'

export type ResidualMode = 'abs' | 'pct'

interface Props {
  rows: MonitoringRow[]
  brush: BrushWindow
  onBrush: (w: BrushWindow) => void
  tickFormatter: (t: number) => string
  /** Window residual SD — drives the ±1/±2/±3 guardlines (absolute mode). */
  sd: number
  mode: ResidualMode
}

const SYNC_ID = 'monitoring'
const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 }

function sdCoverage(
  rows: MonitoringRow[],
  sd: number,
): Record<number, { up: number; down: number }> | null {
  if (!Number.isFinite(sd) || sd <= 0) return null

  const residuals = rows
    .map(r => r.residual)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (residuals.length === 0) return null

  const n = residuals.length
  const out: Record<number, { up: number; down: number }> = {}
  for (const k of [1, 2, 3]) {
    const limit = k * sd
    // Counted from zero OUTWARD to the line, so each figure describes the
    // region its own label sits in rather than everything inside it.
    const inner = (k - 1) * sd
    let up = 0
    let down = 0
    for (const r of residuals) {
      if (r > inner && r <= limit) up++
      else if (r < -inner && r >= -limit) down++
    }
    out[k] = { up: (up / n) * 100, down: (down / n) * 100 }
  }
  return out
}

/** A ±k·SD guardline pair (absolute-error mode only). */
/** A ±k·SD guardline pair (absolute-error mode only). */
function SdGuard({
  sd,
  k,
  color,
  pct,
}: {
  sd: number
  k: number
  color: string
  pct?: { up: number; down: number }
}) {
  const y = sd * k
  const dx = (k - 2) * 90

  return (
    <>
      <ReferenceLine
        y={y}
        stroke={color}
        strokeDasharray="3 3"
        strokeOpacity={0.6}
        ifOverflow="extendDomain"
        label={{
          value: pct ? `+${k} SD  ${pct.up.toFixed(1)}%` : `+${k} SD`,
          position: 'insideTop',
          offset: 6,
          dx,
          fill: color,
          fontSize: 12,
          fontWeight: 600,
        }}
      />
      <ReferenceLine
        y={-y}
        stroke={color}
        strokeDasharray="3 3"
        strokeOpacity={0.6}
        ifOverflow="extendDomain"
        label={{
          value: pct ? `-${k} SD  ${pct.down.toFixed(1)}%` : `-${k} SD`,
          position: 'insideBottom',
          offset: 6,
          dx,
          fill: color,
          fontSize: 12,
          fontWeight: 600,
        }}
      />
    </>
  )
}

function SdBackground({ sd }: { sd: number }) {
  return (
    <>
      <ReferenceArea
        y1={sd * 2}
        y2={sd * 3}
        fill="var(--destructive)"
        fillOpacity={0.15}
      />

      {/* Positive: +1 SD → +2 SD */}
      <ReferenceArea
        y1={sd}
        y2={sd * 2}
        fill="var(--chart-3)"
        fillOpacity={0.15}
      />

      {/* Normal: -1 SD → +1 SD */}
      <ReferenceArea
        y1={-sd}
        y2={sd}
        fill="var(--chart-2)"
        fillOpacity={0.25}
      />

      {/* Negative: -2 SD → -1 SD */}
      <ReferenceArea
        y1={-sd * 2}
        y2={-sd}
        fill="var(--chart-3)"
        fillOpacity={0.15}
      />

      {/* Negative: -3 SD → -2 SD */}
      <ReferenceArea
        y1={-sd * 3}
        y2={-sd * 2}
        fill="var(--destructive)"
        fillOpacity={0.15}
      />
    </>
  )
}

export function ResidualChart({
  rows,
  brush,
  onBrush,
  tickFormatter,
  sd,
  mode,
}: Props) {
  const isPct = mode === 'pct'
  const dataKey = isPct ? 'percentageError' : 'residual'

  const coverage = useMemo(
    () => (isPct ? null : sdCoverage(rows, sd)),
    [isPct, rows, sd],
  )

  return (
    <ResponsiveContainer className="w-full " height={500}>
      <ComposedChart
        data={rows}
        syncId={SYNC_ID}
        margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis
          dataKey="t"
          type="number"
          domain={['dataMin', 'dataMax']}
          scale="time"
          tickFormatter={tickFormatter}
          tick={AXIS_TICK}
          stroke="var(--border)"
          minTickGap={40}
        />
        <YAxis
          domain={['auto', 'auto']}
          tick={AXIS_TICK}
          stroke="var(--border)"
          width={44}
          tickFormatter={v => (isPct ? `${v}%` : `${v}`)}
        />
        <Tooltip
          content={
            <MonitoringTooltip
              variant="residual"
              residualMode={mode}
              formatLabel={tickFormatter}
            />
          }
        />

        {/* Perfect-prediction baseline. */}
        <ReferenceLine
          y={0}
          stroke="var(--muted-foreground)"
          strokeDasharray="5 5"
          strokeOpacity={0.6}
        />

        {!isPct && (
          <>
            <SdBackground sd={sd} />

            <SdGuard sd={sd} k={1} color="var(--chart-2)" pct={coverage?.[1]} />
            <SdGuard sd={sd} k={2} color="var(--chart-3)" pct={coverage?.[2]} />
            <SdGuard
              sd={sd}
              k={3}
              color="var(--destructive)"
              pct={coverage?.[3]}
            />
          </>
        )}

        <Area
          type="monotone"
          dataKey={dataKey}
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="var(--chart-1)"
          fillOpacity={0.12}
          isAnimationActive={false}
          dot={false}
        />

        <Brush
          dataKey="t"
          height={22}
          travellerWidth={10}
          stroke="var(--border)"
          fill="var(--muted)"
          tickFormatter={t => tickFormatter(Number(t))}
          startIndex={brush.startIndex}
          endIndex={brush.endIndex}
          onChange={onBrush}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
