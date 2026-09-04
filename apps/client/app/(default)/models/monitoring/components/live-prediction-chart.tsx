'use client'

import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { LivePredictionPoint } from '@/hooks/model/use-prediction-monitoring'

interface Props {
  points: LivePredictionPoint[]
}

/**
 * MODEL-SERVE-005. The sampled synchronous-/predict stream, plotted alone —
 * no actual/residual/SD bands, because none exist yet (T03, ground truth,
 * is blocked). Deliberately a separate, simpler chart from
 * `ActualVsPredictChart` rather than that component fed a fabricated
 * `actual` value.
 */
export function LivePredictionChart({ points }: Props) {
  if (points.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No sampled predictions in this range yet.
      </div>
    )
  }

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={iso =>
              new Date(iso).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            }
            tick={{ fontSize: 10 }}
            stroke="var(--muted-foreground)"
          />
          <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
          <Tooltip
            labelFormatter={iso => new Date(iso as string).toLocaleString()}
            formatter={value => [
              typeof value === 'number' ? value.toFixed(4) : String(value),
              'Predicted',
            ]}
          />
          <Line
            type="monotone"
            dataKey="predicted"
            stroke="var(--chart-1)"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
