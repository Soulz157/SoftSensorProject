'use client'

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
import type { FitRow } from '@/lib/model-metrics'
import { EvaluationTooltip } from './evaluation-tooltip'
import { AXIS_TICK, EVAL_SYNC_ID } from './actual-vs-predicted-chart'

interface Props {
  rows: FitRow[]
  /** Residual SD from the fit — drives the ±1/±2/±3 layer boundaries. */
  sd: number
  tickFormatter: (t: number) => string
  /** Name of the compared model — renders a second residual line. */
  compareName?: string
}

/** A ±k·SD guardline pair. */
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
          fontSize: 11,
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
          fontSize: 11,
        }}
      />
    </>
  )
}

/** Three nested SD layers: normal (±1) → elevated (±2) → out of spec (±3). */
function SdBackground({ sd }: { sd: number }) {
  return (
    <>
      <ReferenceArea
        y1={sd * 2}
        y2={sd * 3}
        fill="var(--destructive)"
        fillOpacity={0.15}
      />
      <ReferenceArea
        y1={sd}
        y2={sd * 2}
        fill="var(--chart-3)"
        fillOpacity={0.15}
      />
      <ReferenceArea
        y1={-sd}
        y2={sd}
        fill="var(--chart-2)"
        fillOpacity={0.25}
      />
      <ReferenceArea
        y1={-sd * 2}
        y2={-sd}
        fill="var(--chart-3)"
        fillOpacity={0.15}
      />
      <ReferenceArea
        y1={-sd * 3}
        y2={-sd * 2}
        fill="var(--destructive)"
        fillOpacity={0.15}
      />
    </>
  )
}

/**
 * Residual = Actual − Predicted over time, on 3-layer SD guardrails. A healthy
 * fit stays inside the ±1 SD band with no drift or structure; excursions into
 * the ±2 / ±3 layers mark the samples the model misses.
 */
export function ResidualChart({ rows, sd, tickFormatter, compareName }: Props) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart
        data={rows}
        syncId={EVAL_SYNC_ID}
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
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
          width={48}
          tickFormatter={v => Number(v).toFixed(1)}
        />
        <Tooltip
          content={
            <EvaluationTooltip
              variant="residual"
              compareName={compareName}
              formatLabel={tickFormatter}
            />
          }
        />

        <SdBackground sd={sd} />
        <SdGuard sd={sd} k={1} color="var(--chart-2)" />
        <SdGuard sd={sd} k={2} color="var(--chart-3)" />
        <SdGuard sd={sd} k={3} color="var(--destructive)" />

        {/* Perfect-prediction baseline. */}
        <ReferenceLine
          y={0}
          stroke="var(--muted-foreground)"
          strokeDasharray="5 5"
          strokeOpacity={0.6}
        />

        <Area
          connectNulls
          type="monotone"
          dataKey="residual"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="var(--chart-1)"
          fillOpacity={0.12}
          dot={false}
          isAnimationActive={false}
        />

        {compareName && (
          <Line
            connectNulls
            type="monotone"
            dataKey="compareResidual"
            stroke="var(--chart-4)"
            strokeWidth={1.5}
            strokeDasharray="2 4"
            dot={false}
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
