'use client'

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'
import {
  modeARows,
  modeAHasValidationSeries,
  modeAMetricLabel,
  modeBMarks,
  renderModeFor,
} from '@/lib/run-selection'
import type { CandidateResult } from '@/services/model-draft'

/**
 * MODEL-FLOW-013-T07. Two honest render modes — never one faked into the
 * other. Mode A (a real per-iteration curve) plots `train`, and only when
 * present a second line explicitly labelled "Test split" (never
 * "validation" — MODEL-FLOW-004's own finding on this exact misnomer).
 * Mode B (no curve exists) shows train/test RMSE as two paired marks, never
 * connected by a line — a two-point line is visually indistinguishable
 * from a real curve to a reader.
 */
export function CandidateChart({ candidate }: { candidate: CandidateResult }) {
  return renderModeFor(candidate) === 'A' ? (
    <CandidateChartModeA candidate={candidate} />
  ) : (
    <CandidateChartModeB candidate={candidate} />
  )
}

function CandidateChartModeA({ candidate }: { candidate: CandidateResult }) {
  const rows = modeARows(candidate)
  const hasValidation = modeAHasValidationSeries(candidate)
  const metricLabel = modeAMetricLabel(candidate)
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium text-muted-foreground">
        {metricLabel} over iterations
      </p>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Train
        </span>
        {hasValidation && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Test split
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart
          data={rows}
          margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
        >
          <XAxis
            dataKey="iteration"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={32}
            label={{
              value: metricLabel,
              angle: -90,
              position: 'insideLeft',
              fontSize: 10,
            }}
          />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            formatter={(value: unknown, name: unknown) => [
              typeof value === 'number' ? value.toFixed(4) : String(value),
              name === 'validation' ? 'Test split' : 'Train',
            ]}
          />
          <Line
            type="monotone"
            dataKey="train"
            stroke="var(--primary)"
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
          {hasValidation && (
            <Line
              type="monotone"
              dataKey="validation"
              stroke="#0ea5e9"
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * MODEL-FLOW-013-T07's own Mode B: this algorithm's run produced no
 * per-iteration `lossHistory`, so there is no curve to plot — a disabled
 * placeholder (dashed border, muted background, no interactivity) showing
 * the two RMSE marks `modeBMarks` already derives, explicitly NOT joined by
 * a line (a two-point line reads as a real curve to a viewer, the exact
 * mistake this mode exists to avoid).
 */
function CandidateChartModeB({ candidate }: { candidate: CandidateResult }) {
  const marks = modeBMarks(candidate)
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium text-muted-foreground">
        No loss curve for this algorithm
      </p>
      <p className="text-[10px] text-muted-foreground">
        No iteration-by-iteration curve for this algorithm — train/test RMSE
        shown as marks instead.
      </p>
      <div className="flex h-[120px] items-center justify-center gap-8 rounded-md border border-dashed border-border bg-muted/20">
        {marks.map(mark => (
          <div key={mark.label} className="flex flex-col items-center gap-1">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                mark.label === 'Train' ? 'bg-primary' : 'bg-sky-500',
              )}
            />
            <span className="text-[10px] text-muted-foreground">
              {mark.label}
            </span>
            <span className="font-mono text-xs tabular-nums text-foreground">
              {mark.rmse === null ? '—' : mark.rmse.toFixed(3)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
