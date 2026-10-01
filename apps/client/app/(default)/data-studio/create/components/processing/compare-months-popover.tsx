'use client'

import { CalendarRange } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { MAX_ALL_MONTHS, MAX_MONTHS, monthColor } from '@/lib/monthly-compare'
import type { MonthOption } from '@/lib/time-window'

interface Props {
  /** Candidate tags — the sidebar's active tags that exist in the artifact. */
  tags: string[]
  tag: string | null
  onTagChange: (tag: string) => void
  colorForTag: (tag: string) => string
  /** Every month the artifact spans, oldest first. */
  months: MonthOption[]
  /** Picked month keys, in picked order — that order fixes each colour. */
  picked: string[]
  toggleMonth: (key: string) => void
  /** "All months" scope: `picked` is then every month (latest
   * `MAX_ALL_MONTHS`), the per-month boxes are locked, and the 5-month cap
   * does not apply. */
  allMonths: boolean
  onAllMonthsChange: (all: boolean) => void
}

/**
 * DS-LAKE-031. The "By month" counterpart of `CompareTagsPopover`: ONE tag
 * (D02) and up to `MAX_MONTHS` months of it. Each picked month's swatch is
 * drawn in the colour the chart will use (D03), so the list doubles as the
 * legend key.
 */
export function CompareMonthsPopover({
  tags,
  tag,
  onTagChange,
  colorForTag,
  months,
  picked,
  toggleMonth,
  allMonths,
  onAllMonthsChange,
}: Props) {
  const atCap = picked.length >= MAX_MONTHS
  const truncated = allMonths && picked.length < months.length

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={tag ?? undefined} onValueChange={onTagChange}>
        <SelectTrigger
          aria-label="Tag to compare across months"
          className="h-8 w-55 cursor-pointer font-mono text-xs"
        >
          <SelectValue placeholder="Select a tag" />
        </SelectTrigger>
        <SelectContent>
          {tags.map(t => (
            <SelectItem
              key={t}
              value={t}
              className="cursor-pointer font-mono text-xs"
            >
              <span className="flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colorForTag(t) }}
                />
                {t}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-full text-xs"
          >
            <CalendarRange className="h-3.5 w-3.5" />
            {allMonths
              ? `Compare Months: All (${picked.length})`
              : `Compare Months: ${picked.length}/${MAX_MONTHS}`}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 p-0">
          <div className="border-b border-border p-1.5">
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-accent">
              <Checkbox
                checked={allMonths}
                onCheckedChange={v => onAllMonthsChange(v === true)}
                className="shrink-0"
              />
              All months
              <span className="ml-auto font-normal text-muted-foreground tabular-nums">
                {Math.min(months.length, MAX_ALL_MONTHS)}
              </span>
            </label>
            {truncated && (
              <p className="px-2 pb-1 text-[11px] text-muted-foreground">
                Latest {MAX_ALL_MONTHS} of {months.length} months.
              </p>
            )}
          </div>
          <ScrollArea className="max-h-64">
            <div className="max-h-64 space-y-0.5 p-1.5">
              {months.map(month => {
                const position = picked.indexOf(month.key)
                const isSelected = position >= 0
                // The last picked month cannot be unticked — a comparison of
                // nothing has no chart to show.
                const isLast = isSelected && picked.length === 1
                const disabled = allMonths || (!isSelected && atCap) || isLast
                const row = (
                  <label
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                      disabled
                        ? 'cursor-not-allowed opacity-50'
                        : 'cursor-pointer hover:bg-accent',
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      disabled={disabled}
                      onCheckedChange={() =>
                        !disabled && toggleMonth(month.key)
                      }
                      className="shrink-0"
                    />
                    <span
                      className={cn(
                        'h-2.5 w-2.5 shrink-0 rounded-full',
                        !isSelected && 'ring-1 ring-border',
                      )}
                      style={
                        isSelected
                          ? {
                              backgroundColor: monthColor(
                                position,
                                picked.length,
                              ),
                            }
                          : undefined
                      }
                    />
                    <span className="truncate tabular-nums">{month.label}</span>
                  </label>
                )
                // Locked by "All months": greyed is enough, the toggle above
                // explains it — no per-row tooltip.
                if (allMonths) return <div key={month.key}>{row}</div>
                return disabled ? (
                  <Tooltip key={month.key}>
                    <TooltipTrigger asChild>{row}</TooltipTrigger>
                    <TooltipContent side="left">
                      {isLast
                        ? 'At least one month stays selected.'
                        : `Maximum of ${MAX_MONTHS} months reached. Deselect a month to add another.`}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div key={month.key}>{row}</div>
                )
              })}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}
