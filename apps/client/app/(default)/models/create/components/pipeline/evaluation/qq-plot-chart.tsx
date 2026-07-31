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
import type { QQPoint } from '@/lib/model-evaluation'
import { AXIS_TICK } from './actual-vs-predicted-chart'

interface Props {
  points: QQPoint[]
  /** Symmetric [-m, m] domain shared by both axes (from qqPoints). */
  domain: [number, number]
}

const DARK_TOOLTIP = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 11,
  color: 'var(--foreground)',
}

/**
 * Normal Q-Q plot of the standardized residuals. Theoretical normal quantiles
 * (x) are paired with the sorted sample quantiles (y); the dashed red diagonal
 * is the ideal `y = x`. Points hugging the diagonal ⇒ residuals are normally
 * distributed; systematic curvature ⇒ skew or heavy tails.
 */
export function QQPlotChart({ points, domain }: Props) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          type="number"
          dataKey="theoretical"
          domain={domain}
          tick={AXIS_TICK}
          stroke="var(--border)"
          tickFormatter={v => Number(v).toFixed(1)}
          label={{
            value: 'Theoretical quantiles',
            position: 'insideBottom',
            offset: -10,
            fill: 'var(--muted-foreground)',
            fontSize: 11,
          }}
        />
        <YAxis
          type="number"
          dataKey="sample"
          domain={domain}
          tick={AXIS_TICK}
          stroke="var(--border)"
          width={40}
          tickFormatter={v => Number(v).toFixed(1)}
          label={{
            value: 'Sample quantiles',
            angle: -90,
            position: 'insideLeft',
            fill: 'var(--muted-foreground)',
            fontSize: 11,
          }}
        />
        <ZAxis range={[24, 24]} />
        <Tooltip
          cursor={{ stroke: 'var(--border)', strokeDasharray: '3 3' }}
          contentStyle={DARK_TOOLTIP}
          labelFormatter={() => 'Quantile'}
        />
        {/* Ideal normal reference — dashed red y = x across the full domain. */}
        <ReferenceLine
          stroke="var(--destructive)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          segment={[
            { x: domain[0], y: domain[0] },
            { x: domain[1], y: domain[1] },
          ]}
          ifOverflow="hidden"
        />
        <Scatter
          data={points}
          fill="#22d3ee"
          fillOpacity={0.85}
          isAnimationActive={false}
        />
      </ScatterChart>
    </ResponsiveContainer>
  )
}
