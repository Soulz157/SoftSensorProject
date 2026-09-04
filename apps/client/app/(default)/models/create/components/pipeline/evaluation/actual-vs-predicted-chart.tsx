'use client'

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { FitRow } from '@/lib/model-metrics'
import { EvaluationTooltip } from './evaluation-tooltip'

/** Shared with the residual chart so the crosshair tracks across both. */
export const EVAL_SYNC_ID = 'evaluation'
export const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 }

interface Props {
  rows: FitRow[]
  tickFormatter: (t: number) => string
  /** Name of the compared model — renders a second prediction line. */
  compareName?: string
  /** Defaults to Step 5's full-width 320. MODEL-FLOW-017-T04 renders this
   *  at small-multiple size (~120-160) inside Step 4's candidate cards. */
  height?: number
  /** Defaults to `EVAL_SYNC_ID`, sharing Step 5's crosshair with the
   *  residual chart beside it. MODEL-FLOW-017-T06 gives EACH small-multiple
   *  instance its OWN id (its own runId) — sharing the module default
   *  across N mounted candidates would sync every card's crosshair
   *  together, since `syncId` was a module CONSTANT before this prop
   *  existed, not something the caller could vary per instance. */
  syncId?: string
}

/**
 * Actual vs Predicted over time: the actual series as a solid line, the model's
 * prediction dashed, and a shaded ±1 SD band around the prediction. Samples
 * leaving the band are the ones the fit explains worst.
 */
export function ActualVsPredictedChart({
  rows,
  tickFormatter,
  compareName,
  height = 320,
  syncId = EVAL_SYNC_ID,
}: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={rows}
        syncId={syncId}
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
              variant="fit"
              compareName={compareName}
              formatLabel={tickFormatter}
            />
          }
        />

        {/* ±1 SD band wrapping the ACTUAL line — [actual − SD, actual + SD]. */}
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

        {compareName && (
          <Line
            connectNulls
            type="monotone"
            dataKey="comparePredict"
            stroke="var(--chart-4)"
            strokeWidth={1.5}
            strokeDasharray="2 4"
            dot={false}
            isAnimationActive={false}
          />
        )}

        <Line
          connectNulls
          type="monotone"
          dataKey="actual"
          stroke="var(--foreground)"
          strokeWidth={2}
          dot={false}
          activeDot={{
            r: 4,
            fill: 'var(--foreground)',
            stroke: 'var(--chart-1)',
            strokeWidth: 2,
          }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
