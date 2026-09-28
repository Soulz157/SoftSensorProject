'use client'

import { useId, useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import type { Matcher } from 'react-day-picker'
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
import {
  clampStamp,
  dateToDay,
  dayToDate,
  formatStamp,
  type StampBounds,
} from '@/lib/date-stamp'

/**
 * One end of a date-time window over a dataset: a calendar for the day plus
 * a time of day, as a single `yyyy-MM-ddTHH:mm` stamp. The standard picker
 * for any range bounded by real data — see DESIGN_SYSTEM.md, "Date-time
 * range over data".
 *
 * A calendar, not a native `<input type="date">`: the native picker HIDES
 * every month outside its `min`/`max`, so a range clamped to part of the
 * data (the retrain dialog's cut, for one) made the data's earlier months
 * unreachable, which read as a picker that would not scroll. Here navigation
 * spans the whole of the data (`dataBounds`) and only the days outside
 * `allowed` are greyed out.
 *
 * With a time, not a day alone: a server that checks a window against the
 * data's real first and last READING refuses a whole-day window whenever the
 * data starts or ends part-way through a day. Picking a day starts at
 * `defaultTime` clamped into `allowed`, so a start lands on the first reading
 * and an end on the last without the user touching the time.
 */
export function CalendarDateTimePicker({
  id,
  label,
  value,
  onChange,
  dataBounds,
  allowed,
  defaultTime,
  disabled,
  invalid,
  className,
}: {
  /** For a visible `<Label htmlFor>` beside the trigger. */
  id?: string
  /** Accessible name, e.g. "Validation window start". */
  label: string
  /** `yyyy-MM-ddTHH:mm`, or '' when nothing is chosen yet. */
  value: string
  onChange: (stamp: string) => void
  /** The data's real first/last reading — how far the calendar can page. */
  dataBounds: StampBounds | null
  /** The pickable instants. Either end may be absent. */
  allowed: { min?: string; max?: string }
  /** Time given to a freshly picked day, before clamping: '00:00' for a
   *  start, '23:59' for an end. */
  defaultTime: string
  disabled?: boolean
  invalid?: boolean
  /** Trigger width etc. — e.g. `w-full` in a form grid. */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const timeId = useId()
  const day = value.slice(0, 10)
  const time = value.slice(11, 16)
  const selected = dayToDate(day) ?? undefined
  const minDay = allowed.min ? dayToDate(allowed.min.slice(0, 10)) : null
  const maxDay = allowed.max ? dayToDate(allowed.max.slice(0, 10)) : null
  const firstDataDay = dataBounds
    ? dayToDate(dataBounds.min.slice(0, 10))
    : null
  const lastDataDay = dataBounds ? dayToDate(dataBounds.max.slice(0, 10)) : null
  const disabledDays: Matcher[] = [
    ...(minDay ? [{ before: minDay }] : []),
    ...(maxDay ? [{ after: maxDay }] : []),
  ]
  // The time spinner's own limits, only on a day a bound falls on. The
  // caller's validation is still the guard — a typed time gets through.
  const timeMin =
    allowed.min && allowed.min.startsWith(day)
      ? allowed.min.slice(11)
      : undefined
  const timeMax =
    allowed.max && allowed.max.startsWith(day)
      ? allowed.max.slice(11)
      : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-label={label}
          aria-invalid={invalid}
          disabled={disabled}
          className={cn(
            'h-8 justify-start gap-2 px-2.5 text-xs font-normal tabular-nums',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
          {value ? formatStamp(value) : 'Pick a day'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          selected={selected}
          // Open on the chosen day, else the first pickable one — which may
          // be later than the first day of data when `allowed` is narrower.
          defaultMonth={selected ?? minDay ?? firstDataDay ?? undefined}
          startMonth={firstDataDay ?? undefined}
          endMonth={lastDataDay ?? undefined}
          disabled={disabledDays}
          onSelect={date => {
            if (!date) return
            // A re-picked day keeps the user's own time, else the default.
            onChange(clampStamp(dateToDay(date), time || defaultTime, allowed))
          }}
        />
        <div className="flex items-center gap-2 border-t border-border p-2">
          <Label htmlFor={timeId} className="text-xs">
            Time
          </Label>
          <Input
            id={timeId}
            type="time"
            aria-label={`${label} time`}
            className="h-8 w-auto text-xs tabular-nums"
            disabled={!day}
            min={timeMin}
            max={timeMax}
            value={time}
            onChange={e => {
              if (day && e.target.value) onChange(`${day}T${e.target.value}`)
            }}
          />
          <Button
            type="button"
            size="sm"
            className="ml-auto h-8"
            onClick={() => setOpen(false)}
          >
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
