'use client'

import { useEffect, useMemo } from 'react'
import { CalendarRange } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  monthOptions,
  windowMonthKey,
  type TimeWindow,
} from '@/lib/time-window'

/** Radix `SelectItem` rejects an empty value, so "no window" needs a name. */
const ALL = 'all'

interface Props {
  /** The artifact's first and last timestamp. The picker offers every month
   * between them, and renders nothing when either is missing. */
  startTime: string | null | undefined
  endTime: string | null | undefined
  value: TimeWindow | null
  onChange: (window: TimeWindow | null) => void
  /** The next window's rows are in flight; what is on screen is the last one's. */
  loading?: boolean
  /** Visible label and accessible name. Two pickers on one screen (the compare
   * modal's train and validation sides) must not both read just "Period". */
  label?: string
  className?: string
}

/**
 * Month picker for the EDA views. Controlled and presentational — the caller
 * owns where the window lives (a wizard atom, or local state) and what it
 * fetches. "All months" is `null`, which every consumer reads as the whole
 * artifact.
 */
export function MonthWindowSelect({
  startTime,
  endTime,
  value,
  onChange,
  loading = false,
  label = 'Period',
  className,
}: Props) {
  const options = useMemo(
    () => monthOptions(startTime, endTime),
    [startTime, endTime],
  )
  const selectedKey = windowMonthKey(value)
  const known = options.some(option => option.key === selectedKey)

  // A window left over from another artifact must not outlive it: it would
  // filter the new one to nothing while the select showed a month that no
  // longer exists. Only once the range is known, so a metadata fetch still in
  // flight cannot clear a window that is perfectly valid.
  useEffect(() => {
    if (value && options.length > 0 && !known) onChange(null)
  }, [value, options.length, known, onChange])

  // One month is the whole artifact — nothing to choose between.
  if (options.length < 2) return null

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <CalendarRange
        className="h-3.5 w-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <Select
        value={known ? selectedKey : ALL}
        onValueChange={key =>
          onChange(
            key === ALL
              ? null
              : (options.find(option => option.key === key)?.window ?? null),
          )
        }
      >
        <SelectTrigger
          aria-label={label}
          className="h-8 w-44 cursor-pointer text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL} className="cursor-pointer text-xs">
            All months (overview)
          </SelectItem>
          {options.map(option => (
            <SelectItem
              key={option.key}
              value={option.key}
              className="cursor-pointer text-xs"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span
        role="status"
        aria-live="polite"
        className="text-[11px] text-muted-foreground"
      >
        {loading ? 'Updating…' : ''}
      </span>
    </div>
  )
}
