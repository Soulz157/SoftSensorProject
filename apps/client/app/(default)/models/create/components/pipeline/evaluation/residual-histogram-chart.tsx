'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { HistogramBin } from '@/lib/model-evaluation'
import { AXIS_TICK } from './actual-vs-predicted-chart'

interface Props {
  bins: HistogramBin[]
}

const DARK_TOOLTIP = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 11,
  color: 'var(--foreground)',
}

/**
 * Residual Distribution histogram. Bars are the binned counts of
 * `residual = actual − predicted`; a red guideline at x = 0 marks the
 * zero-error baseline. A centred, symmetric distribution around 0 indicates an
 * unbiased fit; a shifted mass reveals systematic over/under-prediction.
 */
export function ResidualHistogramChart({ bins }: Props) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={bins}
        margin={{ top: 8, right: 12, left: 0, bottom: 18 }}
        barCategoryGap={1}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis
          dataKey="mid"
          type="number"
          domain={['dataMin', 'dataMax']}
          tick={AXIS_TICK}
          stroke="var(--border)"
          tickFormatter={v => Number(v).toFixed(2)}
          label={{
            value: 'Residual',
            position: 'insideBottom',
            offset: -10,
            fill: 'var(--muted-foreground)',
            fontSize: 11,
          }}
        />
        <YAxis
          allowDecimals={false}
          tick={AXIS_TICK}
          stroke="var(--border)"
          width={40}
          label={{
            value: 'Frequency',
            angle: -90,
            position: 'insideLeft',
            fill: 'var(--muted-foreground)',
            fontSize: 11,
          }}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', fillOpacity: 0.3 }}
          contentStyle={DARK_TOOLTIP}
          labelFormatter={v => `Residual ≈ ${Number(v).toFixed(3)}`}
        />
        <ReferenceLine
          x={0}
          stroke="var(--destructive)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          ifOverflow="extendDomain"
        />
        <Bar dataKey="count" fill="#f59e0b" radius={[2, 2, 0, 0]}>
          {bins.map((_, i) => (
            <Cell key={i} fill="#f59e0b" fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
