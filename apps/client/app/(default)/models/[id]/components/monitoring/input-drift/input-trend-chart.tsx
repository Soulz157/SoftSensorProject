'use client'

import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format } from 'date-fns'
import { ChartZoomControls } from '@/components/charts/chart-zoom-controls'
import type { BrushWindow } from '@/lib/monitoring'
import type { InputTrendSeries } from '@/services/model-monitoring'
import {
  formatDriftValue,
  trendChartRows,
  trendYDomain,
  type TrendChartRow,
} from '@/lib/input-drift'

interface Props {
  column: string
  series: InputTrendSeries
  trainMin: number | null
  trainMax: number | null
}

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 }

/**
 * MODEL-SERVE-036. The tag's own trend in engineering units: one point per
 * row (raw) or a bucket mean with its min–max envelope (long ranges), the
 * training range as dashed lines, the area outside it shaded, and every
 * point the backend counted as out of range marked.
 *
 * Out-of-range marks and shading use `--chart-4`, not a status red: the
 * verdict lives in the badge; the chart shows where it came from.
 */
export function InputTrendChart({ column, series, trainMin, trainMax }: Props) {
  const rows = useMemo(
    () => trendChartRows(series, trainMin, trainMax),
    [series, trainMin, trainMax],
  )
  const [brush, setBrush] = useState<BrushWindow>({})
  const start = brush.startIndex ?? 0
  const end = brush.endIndex ?? Math.max(0, rows.length - 1)
  const visible = rows.slice(start, end + 1)
  const domain = trendYDomain(
    visible.map(r => ({
      min: r.envelope?.[0] ?? r.value,
      max: r.envelope?.[1] ?? r.value,
    })),
    trainMin,
    trainMax,
  )
  const bucketed = series.resolution === 'bucketed'
  const spanMs = visible.length > 1 ? visible.at(-1)!.t - visible[0]!.t : 0
  const tickFormat = spanMs > 2 * 24 * 3600_000 ? 'MMM d' : 'HH:mm'

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend bucketed={bucketed} bucketMinutes={series.bucketMinutes} />
        <ChartZoomControls
          brush={brush}
          total={rows.length}
          onChange={setBrush}
        />
      </div>
      <div className="w-full overflow-x-auto overflow-y-hidden">
        <div className="min-w-160 xl:w-full xl:min-w-0">
          <ResponsiveContainer className="w-full" height={280}>
            <ComposedChart
              data={visible}
              margin={{ top: 8, right: 88, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={t => format(new Date(t), tickFormat)}
                tick={AXIS_TICK}
                stroke="var(--border)"
                minTickGap={40}
              />
              <YAxis
                domain={domain ?? ['auto', 'auto']}
                allowDataOverflow
                tick={AXIS_TICK}
                stroke="var(--border)"
                width={72}
                tickFormatter={v => formatDriftValue(Number(v))}
              />
              <Tooltip
                content={<TrendTooltip column={column} bucketed={bucketed} />}
              />

              {domain && trainMin !== null && (
                <ReferenceArea
                  y1={domain[0]}
                  y2={trainMin}
                  fill="var(--chart-4)"
                  fillOpacity={0.1}
                  stroke="none"
                />
              )}
              {domain && trainMax !== null && (
                <ReferenceArea
                  y1={trainMax}
                  y2={domain[1]}
                  fill="var(--chart-4)"
                  fillOpacity={0.1}
                  stroke="none"
                />
              )}
              {trainMin !== null && (
                <ReferenceLine
                  y={trainMin}
                  stroke="var(--chart-4)"
                  strokeDasharray="4 4"
                  label={{
                    value: `Train min ${formatDriftValue(trainMin)}`,
                    position: 'right',
                    fill: 'var(--muted-foreground)',
                    fontSize: 10,
                  }}
                />
              )}
              {trainMax !== null && (
                <ReferenceLine
                  y={trainMax}
                  stroke="var(--chart-4)"
                  strokeDasharray="4 4"
                  label={{
                    value: `Train max ${formatDriftValue(trainMax)}`,
                    position: 'right',
                    fill: 'var(--muted-foreground)',
                    fontSize: 10,
                  }}
                />
              )}

              {bucketed && (
                <Area
                  dataKey="envelope"
                  stroke="none"
                  fill="var(--chart-1)"
                  fillOpacity={0.15}
                  isAnimationActive={false}
                  activeDot={false}
                  connectNulls
                />
              )}
              <Line
                dataKey="value"
                stroke="var(--chart-1)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              <Line
                dataKey="outValue"
                stroke="none"
                dot={{ r: 2.5, fill: 'var(--chart-4)', stroke: 'none' }}
                activeDot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function Legend({
  bucketed,
  bucketMinutes,
}: {
  bucketed: boolean
  bucketMinutes: number | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded bg-chart-1" />
        {bucketed
          ? `Mean per ${bucketMinutes ?? '?'} min, min–max shaded`
          : 'Live value (per minute)'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-4 border-t border-dashed border-chart-4" />
        Training range
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-chart-4" />
        Out of range
      </span>
    </div>
  )
}

interface TooltipProps {
  active?: boolean
  payload?: Array<{ payload: TrendChartRow }>
  column: string
  bucketed: boolean
}

function TrendTooltip({ active, payload, column, bucketed }: TooltipProps) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
      <div className="font-medium">
        {format(new Date(row.t), 'MMM d, HH:mm')}
      </div>
      <div className="mt-0.5 font-mono text-[11px]">
        {column}: {formatDriftValue(row.value)}
      </div>
      {bucketed && row.envelope && (
        <div className="font-mono text-[11px] text-muted-foreground">
          min {formatDriftValue(row.envelope[0])} · max{' '}
          {formatDriftValue(row.envelope[1])}
        </div>
      )}
      {row.outValue !== null && (
        <div className="mt-0.5 text-[11px] text-chart-4">
          Outside training range
        </div>
      )}
    </div>
  )
}
