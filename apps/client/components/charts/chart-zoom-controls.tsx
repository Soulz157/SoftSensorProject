'use client'

import { type ComponentProps } from 'react'
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BrushWindow } from '@/lib/monitoring'

// ---- window math (pure, index-based over points/rows) ----
const MIN_SPAN = 4 // จำนวนจุดต่ำสุดที่ยอมให้ซูมเข้าไปได้ (กัน zoom เป็นจุดเดียว)
const ZOOM_IN = 0.6 // shrink span -> 60%
const ZOOM_OUT = 1 / 0.6 // inverse -> grow
const PAN_FRACTION = 0.3 // เลื่อน = 30% ของ span ปัจจุบัน

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v))

/** {} หมายถึง full range -> map เป็น [0, last] เพื่อคำนวณ */
function resolve(brush: BrushWindow, total: number) {
  const last = Math.max(0, total - 1)
  const s = clamp(brush.startIndex ?? 0, 0, last)
  const e = clamp(brush.endIndex ?? last, 0, last)
  return { start: Math.min(s, e), end: Math.max(s, e), last }
}

/** factor < 1 => zoom in, factor > 1 => zoom out. ซูมโดยยึด center ของ view ปัจจุบัน */
function scale(brush: BrushWindow, total: number, factor: number): BrushWindow {
  const { start, end, last } = resolve(brush, total)
  const span = end - start
  const center = (start + end) / 2
  const nextSpan = clamp(
    Math.round(span * factor),
    Math.min(MIN_SPAN, last),
    last,
  )
  let s = Math.round(center - nextSpan / 2)
  let e = s + nextSpan
  if (s < 0) {
    s = 0
    e = nextSpan
  }
  if (e > last) {
    e = last
    s = last - nextSpan
  }
  return { startIndex: s, endIndex: e }
}

/** dir: -1 = ซ้าย (เก่ากว่า), +1 = ขวา (ใหม่กว่า). คง span เดิม */
function shift(brush: BrushWindow, total: number, dir: 1 | -1): BrushWindow {
  const { start, end, last } = resolve(brush, total)
  const span = end - start
  const step = Math.max(1, Math.round(span * PAN_FRACTION)) * dir
  const s = clamp(start + step, 0, last - span)
  return { startIndex: s, endIndex: s + span }
}

interface Props {
  brush: BrushWindow
  total: number
  onChange: (w: BrushWindow) => void
}

/**
 * Pan / zoom / reset panel over an index window. Shared by the monitoring
 * dashboard (paired with a recharts `Brush`) and the Create-Model evaluation
 * charts (which slice rows by the window instead of rendering a brush strip).
 */
export function ChartZoomControls({ brush, total, onChange }: Props) {
  const { start, end, last } = resolve(brush, total)
  const span = end - start
  const isFull = start <= 0 && end >= last
  const atMinZoom = span <= MIN_SPAN
  const noData = total <= 1

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
      <IconBtn
        label="Pan left"
        onClick={() => onChange(shift(brush, total, -1))}
        disabled={noData || start <= 0}
      >
        <ChevronLeft className="h-4 w-4" />
      </IconBtn>
      <IconBtn
        label="Zoom in"
        onClick={() => onChange(scale(brush, total, ZOOM_IN))}
        disabled={noData || atMinZoom}
      >
        <ZoomIn className="h-4 w-4" />
      </IconBtn>
      <IconBtn
        label="Zoom out"
        onClick={() => onChange(scale(brush, total, ZOOM_OUT))}
        disabled={noData || isFull}
      >
        <ZoomOut className="h-4 w-4" />
      </IconBtn>
      <IconBtn
        label="Pan right"
        onClick={() => onChange(shift(brush, total, 1))}
        disabled={noData || end >= last}
      >
        <ChevronRight className="h-4 w-4" />
      </IconBtn>

      <span className="mx-0.5 h-4 w-px bg-border" />

      <IconBtn
        label="Reset zoom"
        onClick={() => onChange({})}
        disabled={noData || isFull}
      >
        <RotateCcw className="h-4 w-4" />
      </IconBtn>
    </div>
  )
}

function IconBtn({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      className="cursor-pointer h-7 w-7 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      {...props}
    >
      {children}
    </Button>
  )
}
