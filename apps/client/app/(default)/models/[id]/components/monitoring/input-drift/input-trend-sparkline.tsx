'use client'

import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  YAxis,
} from 'recharts'
import type { InputTrendSeries } from '@/services/model-monitoring'
import { sparklineRows, trendYDomain } from '@/lib/input-drift'

interface Props {
  series: InputTrendSeries | undefined
  trainMin: number | null
  trainMax: number | null
  /** Shown when there is nothing to draw. */
  emptyLabel?: string
}

/**
 * MODEL-SERVE-036. The row's own small trend: the tag's live values with
 * the training min and max as dashed lines, out-of-range points marked.
 * Decorative summary only — the expanded detail carries the real axis.
 */
export function InputTrendSparkline({
  series,
  trainMin,
  trainMax,
  emptyLabel = 'No live values',
}: Props) {
  if (!series || series.points.length === 0) {
    return (
      <div className="flex h-9 w-full items-center text-[10px] text-muted-foreground/70">
        {emptyLabel}
      </div>
    )
  }
  const rows = sparklineRows(series, trainMin, trainMax)
  const domain = trendYDomain(series.points, trainMin, trainMax)

  return (
    <div className="h-9 w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={rows}
          margin={{ top: 3, right: 2, bottom: 3, left: 2 }}
        >
          <YAxis hide domain={domain ?? ['auto', 'auto']} />
          {trainMin !== null && (
            <ReferenceLine
              y={trainMin}
              stroke="var(--chart-4)"
              strokeDasharray="3 3"
              strokeOpacity={0.8}
            />
          )}
          {trainMax !== null && (
            <ReferenceLine
              y={trainMax}
              stroke="var(--chart-4)"
              strokeDasharray="3 3"
              strokeOpacity={0.8}
            />
          )}
          <Line
            dataKey="value"
            stroke="var(--chart-1)"
            strokeWidth={1.25}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            dataKey="outValue"
            stroke="none"
            dot={{ r: 1.5, fill: 'var(--chart-4)', stroke: 'none' }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
