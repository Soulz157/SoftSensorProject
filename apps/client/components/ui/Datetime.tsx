'use client'

import { useMemo } from 'react'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface DateTimePickerProps {
  id?: string
  value: string // "YYYY-MM-DDTHH:mm"
  onChange: (value: string) => void
  min?: string // "YYYY-MM-DDTHH:mm"
  max?: string // "YYYY-MM-DDTHH:mm"
  disabled?: boolean
  className?: string
  /** Years shown on each side of "now" when min/max are absent. Default 10. */
  yearSpan?: number
  /** Minute increment for the minute select. Default 1. */
  minuteStep?: number
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const pad = (n: number) => n.toString().padStart(2, '0')

interface Parts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
}

/** "YYYY-MM-DDTHH:mm" → Parts (null if unparseable). */
function splitValue(v: string): Parts | null {
  if (!v) return null
  const [datePart, timePart = '00:00'] = v.split('T')
  const [y, m, d] = datePart!.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  if ([y, m, d].some(Number.isNaN)) return null
  return { year: y, month: m, day: d, hour: hh || 0, minute: mm || 0 }
}

const daysInMonth = (year: number, month: number) =>
  new Date(year, month, 0).getDate()

const toDate = (p: Parts) =>
  new Date(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0)

/** Format a Date → "YYYY-MM-DDTHH:mm" (datetime-local string). */
export function toDateTimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Compare two Parts up to a given precision. Returns -1 | 0 | 1.
type Field = 'year' | 'month' | 'day' | 'hour' | 'minute'
const ORDER: Field[] = ['year', 'month', 'day', 'hour', 'minute']
function cmp(a: Parts, b: Parts, upTo: Field): number {
  for (const f of ORDER) {
    if (a[f] !== b[f]) return a[f] < b[f] ? -1 : 1
    if (f === upTo) break
  }
  return 0
}

function Segment({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

export function DateTimePicker({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  yearSpan = 10,
  minuteStep = 1,
}: DateTimePickerProps) {
  const now = new Date()

  const current: Parts = splitValue(value) ?? {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: 0,
    minute: 0,
  }

  const minP = min ? splitValue(min) : null
  const maxP = max ? splitValue(max) : null
  const minDate = minP ? toDate(minP) : null
  const maxDate = maxP ? toDate(maxP) : null

  // Emit a new value: fix day overflow, then clamp to [min, max].
  const commit = (next: Parts) => {
    const maxDay = daysInMonth(next.year, next.month)
    if (next.day > maxDay) next.day = maxDay

    let d = toDate(next)
    if (minDate && d < minDate) d = minDate
    if (maxDate && d > maxDate) d = maxDate
    onChange(toDateTimeLocal(d))
  }

  const years = useMemo(() => {
    const lo = minP ? minP.year : now.getFullYear() - yearSpan
    const hi = maxP ? maxP.year : now.getFullYear() + yearSpan
    const out: number[] = []
    for (let y = lo; y <= hi; y++) out.push(y)
    return out
  }, [minP?.year, maxP?.year, yearSpan, now])

  // Per-field disabling against the min/max boundaries.
  const below = (probe: Parts, f: Field) => minP && cmp(probe, minP, f) < 0
  const above = (probe: Parts, f: Field) => maxP && cmp(probe, maxP, f) > 0
  const monthDisabled = (m: number) =>
    !!below({ ...current, month: m }, 'month') ||
    !!above({ ...current, month: m }, 'month')
  const dayDisabled = (d: number) =>
    !!below({ ...current, day: d }, 'day') ||
    !!above({ ...current, day: d }, 'day')
  const hourDisabled = (h: number) =>
    !!below({ ...current, hour: h }, 'hour') ||
    !!above({ ...current, hour: h }, 'hour')
  const minuteDisabled = (m: number) =>
    !!below({ ...current, minute: m }, 'minute') ||
    !!above({ ...current, minute: m }, 'minute')

  const dayCount = daysInMonth(current.year, current.month)
  const days = Array.from({ length: dayCount }, (_, i) => i + 1)
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const minutes = Array.from(
    { length: Math.ceil(60 / minuteStep) },
    (_, i) => i * minuteStep,
  )

  const triggerCls = 'h-8 text-xs font-mono'

  return (
    <div className={cn('flex flex-wrap items-end gap-2', className)}>
      <Segment label="Day">
        <Select
          value={String(current.day)}
          onValueChange={v => commit({ ...current, day: Number(v) })}
          disabled={disabled}
        >
          <SelectTrigger id={id} className={cn(triggerCls, 'w-[64px]')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {days.map(d => (
              <SelectItem
                key={d}
                value={String(d)}
                disabled={dayDisabled(d)}
                className="text-xs"
              >
                {pad(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Segment>

      <Segment label="Month">
        <Select
          value={String(current.month)}
          onValueChange={v => commit({ ...current, month: Number(v) })}
          disabled={disabled}
        >
          <SelectTrigger className={cn(triggerCls, 'w-[128px]')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((name, i) => (
              <SelectItem
                key={name}
                value={String(i + 1)}
                disabled={monthDisabled(i + 1)}
                className="text-xs"
              >
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Segment>

      <Segment label="Year">
        <Select
          value={String(current.year)}
          onValueChange={v => commit({ ...current, year: Number(v) })}
          disabled={disabled}
        >
          <SelectTrigger className={cn(triggerCls, 'w-[84px]')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map(y => (
              <SelectItem key={y} value={String(y)} className="text-xs">
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Segment>

      <Segment label="Time">
        <div className="flex items-center gap-1">
          <Select
            value={String(current.hour)}
            onValueChange={v => commit({ ...current, hour: Number(v) })}
            disabled={disabled}
          >
            <SelectTrigger className={cn(triggerCls, 'w-[60px]')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hours.map(h => (
                <SelectItem
                  key={h}
                  value={String(h)}
                  disabled={hourDisabled(h)}
                  className="text-xs"
                >
                  {pad(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-xs font-mono text-muted-foreground">:</span>

          <Select
            value={String(current.minute)}
            onValueChange={v => commit({ ...current, minute: Number(v) })}
            disabled={disabled}
          >
            <SelectTrigger className={cn(triggerCls, 'w-[60px]')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {minutes.map(m => (
                <SelectItem
                  key={m}
                  value={String(m)}
                  disabled={minuteDisabled(m)}
                  className="text-xs"
                >
                  {pad(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Segment>
    </div>
  )
}
