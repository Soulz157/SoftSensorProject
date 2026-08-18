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

/** A ±k·SD guardline pair (absolute-error mode only). */
function SdGuard({ sd, k, color }: { sd: number; k: number; color: string }) {
  const y = sd * k
  return (
    <>
      <ReferenceLine
        y={y}
        stroke={color}
        strokeDasharray="3 3"
        strokeOpacity={0.5}
        ifOverflow="extendDomain"
        label={{
          value: `+${k} SD`,
          position: 'insideTopRight',
          fill: color,
          fontSize: 12,
        }}
      />
      <ReferenceLine
        y={-y}
        stroke={color}
        strokeDasharray="3 3"
        strokeOpacity={0.5}
        ifOverflow="extendDomain"
        label={{
          value: `-${k} SD`,
          position: 'insideBottomRight',
          fill: color,
          fontSize: 12,
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

  return (
    <ResponsiveContainer className="w-full" height={500}>
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

            <SdGuard sd={sd} k={1} color="var(--chart-2)" />
            <SdGuard sd={sd} k={2} color="var(--chart-3)" />
            <SdGuard sd={sd} k={3} color="var(--destructive)" />
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
