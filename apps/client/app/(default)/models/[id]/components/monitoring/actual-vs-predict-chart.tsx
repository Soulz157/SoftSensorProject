'use client'

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Brush,
  ResponsiveContainer,
} from 'recharts'
import type { BrushWindow, MonitoringRow } from '@/lib/monitoring'
import { MonitoringTooltip } from './monitoring-tooltip'

export type { BrushWindow }

interface Props {
  rows: MonitoringRow[]
  brush: BrushWindow
  onBrush: (w: BrushWindow) => void
  tickFormatter: (t: number) => string
  actualAsLine?: boolean
  yDomain?: [number, number] | undefined
}

const SYNC_ID = 'monitoring'
const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 }

export function ActualVsPredictChart({
  rows,
  brush,
  onBrush,
  tickFormatter,
  actualAsLine = true,
  yDomain,
}: Props) {
  const startIndex = brush.startIndex ?? 0
  const endIndex = brush.endIndex ?? Math.max(0, rows.length - 1)

  return (
    <div className="w-full overflow-x-auto overflow-y-hidden">
      <div className="min-w-375 ">
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
              domain={yDomain ?? ['auto', 'auto']}
              tick={AXIS_TICK}
              stroke="var(--border)"
              width={44}
            />
            <Tooltip
              content={
                <MonitoringTooltip variant="main" formatLabel={tickFormatter} />
              }
            />

            {/* <Area
              connectNulls
              dataKey="sd3"
              stroke="none"
              fill="var(--destructive)"
              fillOpacity={0.12}
              isAnimationActive={false}
              activeDot={false}
            /> */}
            {/* <Area
              connectNulls
              dataKey="sd2"
              stroke="none"
              fill="var(--chart-3)"
              fillOpacity={0.16}
              isAnimationActive={false}
              activeDot={false}
            /> */}
            <Area
              connectNulls
              dataKey="sd1"
              stroke="none"
              fill="var(--chart-2)"
              fillOpacity={0.42}
              isAnimationActive={false}
              activeDot={false}
            />

            <Line
              connectNulls
              type="monotone"
              dataKey="predict"
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              isAnimationActive={false}
            />

            <Line
              connectNulls
              type="monotone"
              dataKey="actual"
              stroke="var(--foreground)"
              strokeOpacity={actualAsLine ? 1 : 0.35}
              strokeWidth={actualAsLine ? 2 : 1}
              dot={
                actualAsLine
                  ? false
                  : { r: 2.5, fill: 'var(--foreground)', strokeWidth: 0 }
              }
              activeDot={{
                r: 5,
                fill: 'var(--foreground)',
                stroke: 'var(--chart-1)',
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />

            {rows.length > 0 && (
              <Brush
                dataKey="t"
                height={22}
                travellerWidth={10}
                stroke="var(--border)"
                fill="var(--muted)"
                tickFormatter={t => tickFormatter(Number(t))}
                startIndex={startIndex}
                endIndex={endIndex}
                onChange={onBrush}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
