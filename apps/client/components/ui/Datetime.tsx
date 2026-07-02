'use client'

import { useState } from 'react'
import { format, isSameDay, isValid, parseISO } from 'date-fns'
import { CalendarIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface DateTimePickerProps {
  id?: string
  value: string // "YYYY-MM-DDTHH:mm"
  onChange: (value: string) => void
  min?: string // "YYYY-MM-DDTHH:mm"
  max?: string // "YYYY-MM-DDTHH:mm"
  disabled?: boolean
  placeholder?: string
  className?: string
}

/** Format a Date → "YYYY-MM-DDTHH:mm" (datetime-local string). */
export function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const parseDateTimeLocal = (v: string): Date | undefined => {
  if (!v) return undefined
  const d = parseISO(v)
  return isValid(d) ? d : undefined
}

export function DateTimePicker({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  placeholder = 'Pick date & time',
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false)

  const parsed = parseDateTimeLocal(value)
  const minDate = min ? parseDateTimeLocal(min) : undefined
  const maxDate = max ? parseDateTimeLocal(max) : undefined

  const timePart = value?.split('T')[1]?.slice(0, 5) ?? '00:00'

  // Clamp time input bounds when selected day is the same as the min/max boundary day
  const minTime =
    parsed && minDate && isSameDay(parsed, minDate)
      ? min!.split('T')[1]?.slice(0, 5)
      : undefined
  const maxTime =
    parsed && maxDate && isSameDay(parsed, maxDate)
      ? max!.split('T')[1]?.slice(0, 5)
      : undefined

  const handleDaySelect = (day: Date | undefined) => {
    if (!day) return
    const [hh, mm] = timePart.split(':')
    day.setHours(Number(hh), Number(mm), 0, 0)
    onChange(toDateTimeLocal(day))
  }

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const datePart =
      value?.split('T')[0] ?? toDateTimeLocal(new Date()).split('T')[0]
    onChange(`${datePart}T${e.target.value}`)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-8 w-full justify-start gap-2 px-3 font-mono text-xs font-normal',
            !parsed && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {parsed ? format(parsed, 'dd MMM yyyy, HH:mm') : placeholder}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={parsed}
          onSelect={handleDaySelect}
          disabled={day => {
            if (minDate && day < minDate) return true
            if (maxDate && day > maxDate) return true
            return false
          }}
        />

        <div className="border-t px-3 py-2">
          <div className="flex items-center gap-2">
            <Label className="shrink-0 text-xs text-muted-foreground">
              Time
            </Label>
            <Input
              type="time"
              value={timePart}
              min={minTime}
              max={maxTime}
              onChange={handleTimeChange}
              className="h-7 font-mono text-xs"
            />
          </div>
        </div>

        <div className="border-t px-3 py-2">
          <Button
            type="button"
            size="sm"
            className="h-7 w-full text-xs"
            onClick={() => setOpen(false)}
          >
            Confirm
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
