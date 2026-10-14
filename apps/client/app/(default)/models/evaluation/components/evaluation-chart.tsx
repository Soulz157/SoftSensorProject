'use client'

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import {
  formatAxisValue,
  formatWallClockFull,
  pickTimeFormat,
} from '@/lib/monitoring'
import type { ChartRow } from '@/lib/evaluation-compare'

/** Shared with the X-tag mini charts so the cursor moves through all of them. */
export const EVALUATION_SYNC_ID = 'evaluation'

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 }

function EvaluationTooltip({
  active,
  payload,
}: Partial<TooltipContentProps<number, string>>) {
  const row = payload?.[0]?.payload as ChartRow | undefined
  if (!active || !row) return null
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">
        {formatWallClockFull(row.t)}
      </p>
      {row.predicted !== null ? (
        <p className="mt-1 text-muted-foreground">
          Predicted{' '}
          <span className="tabular-nums text-foreground">
            {formatAxisValue(row.predicted)}
          </span>
        </p>
      ) : (
        <p className="mt-1 max-w-64 text-muted-foreground">
          Not scored. {row.skippedReason}
        </p>
      )}
      {row.lab !== null && row.labAt !== null && (
        <p className="mt-0.5 text-muted-foreground">
          Lab{' '}
          <span className="tabular-nums text-foreground">
            {formatAxisValue(row.lab)}
          </span>{' '}
          <span className="text-[11px]">
            measured {formatWallClockFull(row.labAt)}
          </span>
        </p>
      )}
    </div>
  )
}

/**
 * MODEL-SERVE-032. Actual (lab) vs Predicted over the imported range.
 *
 * Same axis conventions as Monitoring's chart: a numeric time axis on plant
 * wall-clock, and `lib/monitoring`'s tick and tooltip formatters. The
 * prediction line does NOT bridge unscored rows (`connectNulls` is off): a
 * row whose inputs were not Good is a visible break, never an interpolated
 * line. Lab values are dots with no connecting stroke — a lab result is an
 * instant, and a line between two would claim a continuity nobody measured.
 */
export function EvaluationChart({ rows }: { rows: ChartRow[] }) {
  const firstT = rows[0]?.t
  const lastT = rows[rows.length - 1]?.t
  const span = firstT !== undefined && lastT !== undefined ? lastT - firstT : 0
  const tickFormatter = pickTimeFormat(span)

  return (
    <div className="w-full overflow-x-auto overflow-y-hidden">
      <div className="min-w-375 xl:w-full xl:min-w-0">
        <ResponsiveContainer className="w-full" height={380}>
          <ComposedChart
            data={rows}
            syncId={EVALUATION_SYNC_ID}
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
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={tickFormatter}
              tick={AXIS_TICK}
              stroke="var(--border)"
              minTickGap={40}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={AXIS_TICK}
              stroke="var(--border)"
              width={78}
              tickFormatter={formatAxisValue}
            />
            <Tooltip content={<EvaluationTooltip />} />
            <Line
              type="monotone"
              dataKey="predicted"
              name="Predicted"
              stroke="var(--foreground)"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              activeDot={{
                r: 4,
                fill: 'var(--foreground)',
                stroke: 'var(--background)',
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="lab"
              name="Lab (actual)"
              stroke="none"
              dot={{ r: 4, fill: 'var(--chart-1)', strokeWidth: 0 }}
              activeDot={{
                r: 6,
                fill: 'var(--chart-1)',
                stroke: 'var(--background)',
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
