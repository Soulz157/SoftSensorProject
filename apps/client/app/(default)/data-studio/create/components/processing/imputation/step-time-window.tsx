'use client'

import { X } from 'lucide-react'
import { CalendarDateTimePicker } from '@/components/calendar-date-time-picker'
import type { StampBounds } from '@/lib/date-stamp'

interface Props {
  startTime: string | undefined
  endTime: string | undefined
  onChange: (next: { startTime?: string; endTime?: string }) => void
  /** First/last loaded reading — how far the calendars can page. */
  dataBounds: StampBounds | null
}

/**
 * DS-LAKE-032-D02. Optional Start/End for Clip Bounds, Crop to Range and
 * Exclude Range: the step only touches readings inside it. Either end may be
 * left open; both empty means the whole series, exactly as before. Each
 * picker's `allowed` range stops it crossing the other end, so the window can
 * never be inverted.
 */
export function StepTimeWindow({
  startTime,
  endTime,
  onChange,
  dataBounds,
}: Props) {
  const hasWindow = Boolean(startTime || endTime)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-muted-foreground">Window</span>
      <CalendarDateTimePicker
        label="Step window start"
        value={startTime ?? ''}
        onChange={stamp => onChange({ startTime: stamp || undefined, endTime })}
        dataBounds={dataBounds}
        allowed={{ min: dataBounds?.min, max: endTime || dataBounds?.max }}
        defaultTime="00:00"
        className="h-7 text-[11px]"
      />
      <span className="text-[11px] text-muted-foreground">–</span>
      <CalendarDateTimePicker
        label="Step window end"
        value={endTime ?? ''}
        onChange={stamp => onChange({ startTime, endTime: stamp || undefined })}
        dataBounds={dataBounds}
        allowed={{ min: startTime || dataBounds?.min, max: dataBounds?.max }}
        defaultTime="23:59"
        className="h-7 text-[11px]"
      />
      {hasWindow ? (
        <button
          type="button"
          aria-label="Clear window"
          onClick={() => onChange({})}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="text-[11px] text-muted-foreground">Whole series</span>
      )}
    </div>
  )
}
