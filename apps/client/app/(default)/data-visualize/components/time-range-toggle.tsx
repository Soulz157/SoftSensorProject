'use client'

import { cn } from '@/lib/utils'
import { TIME_RANGES, type TimeRange } from '@/lib/mock-readings'

interface Props {
  value: TimeRange
  onChange: (range: TimeRange) => void
  disabled?: boolean
}

export function TimeRangeToggle({ value, onChange, disabled }: Props) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="flex overflow-hidden rounded-lg border border-border"
    >
      {TIME_RANGES.map(range => (
        <button
          key={range}
          type="button"
          aria-pressed={value === range}
          disabled={disabled}
          onClick={() => onChange(range)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium tabular-nums transition-colors disabled:opacity-50',
            value === range
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {range}
        </button>
      ))}
    </div>
  )
}
