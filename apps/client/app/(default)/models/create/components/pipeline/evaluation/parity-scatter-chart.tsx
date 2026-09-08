'use client'

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import type { FitRow } from '@/lib/model-metrics'
import type { LegendEntry } from '@/components/charts/chart-legend'
import { AXIS_TICK } from './actual-vs-predicted-chart'

interface Props {
  rows: FitRow[]
  domain: [number, number]
  population: string
}

const DOT_COLOR = 'var(--chart-2)'
const DOT_OPACITY = 0.6
const IDENTITY_COLOR = 'var(--muted-foreground)'
const IDENTITY_DASH = '5 4'
const IDENTITY_WIDTH = 1.5

export const PARITY_LEGEND: LegendEntry[] = [
  {
    shape: 'dot',
    color: DOT_COLOR,
    opacity: DOT_OPACITY,
    label: 'Predictions',
  },
  {
    shape: 'dashed',
    color: IDENTITY_COLOR,
    label: 'Perfect Predictions (y = x)',
  },
]

export function ParityScatterChart({ rows, domain, population }: Props) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          type="number"
          dataKey="actual"
          domain={domain}
          tick={AXIS_TICK}
          stroke="var(--border)"
          tickFormatter={v => Number(v).toFixed(1)}
          label={{
            value: `${population} actual`,
            position: 'insideBottom',
            offset: -10,
            fill: 'var(--muted-foreground)',
            fontSize: 11,
          }}
        />
        <YAxis
          type="number"
          dataKey="predict"
          domain={domain}
          tick={AXIS_TICK}
          stroke="var(--border)"
          width={48}
          tickFormatter={v => Number(v).toFixed(1)}
          label={{
            value: 'Predicted',
            angle: -90,
            position: 'insideLeft',
            fill: 'var(--muted-foreground)',
            fontSize: 11,
          }}
        />
        <ZAxis range={[24, 24]} />
        <Tooltip
          cursor={{ stroke: 'var(--border)', strokeDasharray: '3 3' }}
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 11,
            color: 'var(--foreground)',
          }}
          formatter={(value, name) => [
            Number(value).toFixed(3),
            name === 'actual' ? `${population} actual` : 'Predicted',
          ]}
        />
        {/* Identity line y = x — NOT a fit. See module doc. */}
        <ReferenceLine
          stroke={IDENTITY_COLOR}
          strokeWidth={IDENTITY_WIDTH}
          strokeDasharray={IDENTITY_DASH}
          segment={[
            { x: domain[0], y: domain[0] },
            { x: domain[1], y: domain[1] },
          ]}
          ifOverflow="hidden"
        />
        <Scatter
          data={rows}
          fill={DOT_COLOR}
          fillOpacity={DOT_OPACITY}
          isAnimationActive={false}
        />
      </ScatterChart>
    </ResponsiveContainer>
  )
}
