'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { CalendarIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

function endOfDayIso(day: Date): string {
  const d = new Date(day)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

function startOfDayIso(day: Date): string {
  const d = new Date(day)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function AlertDateRangeFilter({
  dateFrom,
  dateTo,
  onChange,
}: {
  dateFrom: string | null
  dateTo: string | null
  onChange: (dateFrom: string | null, dateTo: string | null) => void
}) {
  const [open, setOpen] = useState(false)

  const fromDate = dateFrom ? new Date(dateFrom) : undefined
  const toDate = dateTo ? new Date(dateTo) : undefined
  const hasRange = Boolean(dateFrom || dateTo)

  const label = hasRange
    ? `${fromDate ? format(fromDate, 'dd MMM yyyy') : '…'} – ${toDate ? format(toDate, 'dd MMM yyyy') : '…'}`
    : 'Date range'

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              'h-9 justify-start gap-2 px-3 text-xs font-normal',
              !hasRange && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={{ from: fromDate, to: toDate }}
            onSelect={range => {
              onChange(
                range?.from ? startOfDayIso(range.from) : null,
                range?.to ? endOfDayIso(range.to) : null,
              )
            }}
          />
        </PopoverContent>
      </Popover>

      {hasRange && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
          aria-label="Clear date range"
          onClick={() => onChange(null, null)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
