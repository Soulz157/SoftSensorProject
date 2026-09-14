'use client'

import { TrendingUp } from 'lucide-react'
import type { TimeRange } from '@/lib/mock-readings'
import { TimeRangeToggle } from './time-range-toggle'

interface Props {
  range: TimeRange
  onRange: (r: TimeRange) => void
  /** MODEL-SERVE-005-T03. NULL when no lab result has been joined in this
   *  range — rendered as a dash, never as `0.00`. An error of zero is a
   *  perfect model; no ground truth is not, and the two must not look
   *  alike on a KPI tile someone reads at a glance. */
  rmse: number | null
  tag: string | null
  /** How many joined pairs that RMSE is over. A number computed from three
   *  lab samples should not present itself like one computed from three
   *  hundred. */
  pairCount?: number | null
}

/** Time-range selector + RMSE KPI for the Monitoring tab. Same as the old
 *  standalone page's `MonitoringToolbar` minus the model picker — `[id]`
 *  already resolved the model. */
export function MonitoringRangeBar({
  range,
  onRange,
  rmse,
  tag,
  pairCount,
}: Props) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        {tag && (
          <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
            target: {tag}
          </span>
        )}

        <TimeRangeToggle range={range} onRange={onRange} />
      </div>

      {/* KPI: RMSE over the joined ground-truth pairs in this range. */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-3 p-4">
        <div className="rounded-lg bg-chart-1/10 p-2">
          <TrendingUp className="h-5 w-5 text-chart-1" />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Live RMSE
          </p>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
              {rmse === null ? '—' : rmse.toFixed(2)}
            </span>
            <span className="text-xs text-muted-foreground">
              {rmse === null
                ? 'awaiting lab results'
                : pairCount
                  ? `units · ${pairCount} lab ${pairCount === 1 ? 'sample' : 'samples'}`
                  : 'units'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
