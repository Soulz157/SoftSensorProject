'use client'

import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { trendTooltipRows, type TrendTooltipEntry } from '@/lib/trend-tooltip'

/** The slice of a Recharts tooltip payload item this tooltip reads. */
interface PayloadItem {
  name?: unknown
  value?: unknown
  color?: string
}

interface Props {
  active?: boolean
  payload?: ReadonlyArray<PayloadItem>
  label?: unknown
  /** Listed first, so the tag being looked at is never cut off. */
  focused?: readonly string[]
  labelFormatter?: (label: unknown) => string
}

/**
 * Line-chart tooltip that stays a bounded size however many tags are plotted
 * (2026-10-19): at most `TREND_TOOLTIP_MAX_ROWS` rows, two columns once it is
 * long, and "+N more" for the rest (`trendTooltipRows`). Styled like the stock
 * `ChartTooltipContent` (components/ui/chart.tsx, which is generated and not
 * edited here) so the swap is invisible at a handful of tags.
 */
export function TrendTooltip({
  active,
  payload,
  label,
  focused,
  labelFormatter,
}: Props) {
  if (!active || !payload?.length) return null

  const entries: TrendTooltipEntry[] = payload.map(item => ({
    name: String(item.name ?? ''),
    value: typeof item.value === 'number' ? item.value : Number.NaN,
    color: item.color,
  }))
  const { shown, hidden, twoColumns } = trendTooltipRows(entries, focused)
  if (shown.length === 0) return null

  return (
    <div
      className={cn(
        'grid max-w-[min(36rem,calc(100vw-2rem))] gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl',
        twoColumns ? 'min-w-80' : 'min-w-32',
      )}
    >
      <div className="font-medium">
        {labelFormatter ? labelFormatter(label) : String(label ?? '')}
      </div>
      <div
        className={cn(
          'grid gap-x-4 gap-y-1.5',
          twoColumns ? 'grid-cols-2' : 'grid-cols-1',
        )}
      >
        {shown.map(entry => (
          <div key={entry.name} className="flex min-w-0 items-center gap-2">
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
              style={{ '--color-bg': entry.color } as CSSProperties}
            />
            <span
              className="min-w-0 flex-1 truncate text-muted-foreground"
              title={entry.name}
            >
              {entry.name}
            </span>
            <span className="font-mono font-medium text-foreground tabular-nums">
              {entry.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <div className="text-muted-foreground">
          +{hidden} more {hidden === 1 ? 'tag' : 'tags'} — focus a tag to list
          it first
        </div>
      )}
    </div>
  )
}
