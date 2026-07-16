'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Scissors, RotateCcw, MousePointerSquareDashed } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import * as SliderPrimitive from '@radix-ui/react-slider'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { toChartRows, type Dataset } from '@/lib/preprocessing'
import {
  nearestTimestampIndex,
  type CropRange,
  type ValueCrop,
} from '@/lib/precleanse'
import { DateTimePicker, toDateTimeLocal } from '@/components/ui/Datetime'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'
import type { SensorChartRow } from '@/hooks/use-sensor-readings'
import { cn } from '@/lib/utils'

interface Props {
  rawDataset: Dataset
  chartDataset: Dataset
  cropRange: CropRange
  onCropChange: (range: CropRange) => void
  valueCrop: ValueCrop
  onValueCropChange: (crop: ValueCrop) => void
  /** Tag the Y-axis crop is keyed to. When absent (multi-tag), Y crop is off. */
  scopeTag?: string
}

const COMMIT_MS = 300
/** Chart plot height in px — fixed so the drag-box pixel→value math is stable. */
const CHART_H = 288

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function SliderWithTooltip({
  min,
  max,
  step,
  value,
  onValueChange,
  disabled,
  tooltipLabels,
}: {
  min: number
  max: number
  step: number
  value: [number, number]
  onValueChange: (v: [number, number]) => void
  disabled?: boolean
  tooltipLabels: [string, string]
}) {
  const [activeThumb, setActiveThumb] = useState<number | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showTooltip = (idx: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setActiveThumb(idx)
  }

  const hideTooltip = () => {
    hideTimer.current = setTimeout(() => setActiveThumb(null), 120)
  }

  const pct = (v: number) => (max === min ? 0 : ((v - min) / (max - min)) * 100)

  return (
    <div className="relative w-full px-1 pt-6">
      {([0, 1] as const).map(idx => {
        const show = activeThumb === idx
        const p = pct(value[idx])
        return (
          <div
            key={idx}
            style={{ left: `clamp(24px, ${p}%, calc(100% - 24px))` }}
            className={cn(
              'pointer-events-none absolute -top-1 -translate-x-1/2 transition-all duration-100',
              show ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1',
            )}
          >
            <span className="whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background shadow-md">
              {tooltipLabels[idx]}
            </span>
            <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-foreground" />
          </div>
        )
      })}

      {/* Radix Slider — custom thumbs to hook pointer events */}
      <SliderPrimitive.Root
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={v => onValueChange([v[0] ?? min, v[1] ?? max])}
        disabled={disabled}
        className="relative flex w-full touch-none select-none items-center"
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>

        {([0, 1] as const).map(idx => (
          <SliderPrimitive.Thumb
            key={idx}
            onPointerDown={() => showTooltip(idx)}
            onPointerUp={hideTooltip}
            onPointerLeave={hideTooltip}
            onFocus={() => showTooltip(idx)}
            onBlur={hideTooltip}
            className={cn(
              'block h-4 w-4 rounded-full border-2 border-primary bg-background',
              'shadow-md ring-offset-background transition-colors',
              'focus-visible:outline-none focus-visible:ring-2',
              'focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:pointer-events-none disabled:opacity-50',
              'cursor-grab active:cursor-grabbing',
            )}
          />
        ))}
      </SliderPrimitive.Root>
    </div>
  )
}

/**
 * Start / End datetime inputs, 2-way bound to the index-based crop slider.
 * `startIdx`/`endIdx` come from the shared `range01` state; editing a field
 * snaps the typed time onto the nearest row index and commits via `onCommit`
 * (= `setRange01`), so slider and inputs stay in sync through one source of
 * truth. Dragging the slider flows back here via the `committed*` effect.
 */
function CropTimeInputs({
  timestamps,
  startIdx,
  endIdx,
  disabled,
  onCommit,
}: {
  timestamps: string[]
  startIdx: number
  endIdx: number
  disabled: boolean
  onCommit: (next: [number, number]) => void
}) {
  const lastIdx = Math.max(0, timestamps.length - 1)

  const committedStart = timestamps[startIdx]
    ? toDateTimeLocal(new Date(timestamps[startIdx]!))
    : ''
  const committedEnd = timestamps[endIdx]
    ? toDateTimeLocal(new Date(timestamps[endIdx]!))
    : ''
  const minBound = timestamps[0]
    ? toDateTimeLocal(new Date(timestamps[0]!))
    : undefined
  const maxBound = timestamps[lastIdx]
    ? toDateTimeLocal(new Date(timestamps[lastIdx]!))
    : undefined

  // Local drafts keep the typed value visible (with the error border) when a
  // commit is blocked; they re-sync whenever the committed indices change
  // (slider drag, external reset, or a successful snap).
  const [startDraft, setStartDraft] = useState(committedStart)
  const [endDraft, setEndDraft] = useState(committedEnd)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setStartDraft(committedStart)
    setEndDraft(committedEnd)
    setInvalid(false)
  }, [committedStart, committedEnd])

  const handleChange = (edge: 0 | 1, raw: string) => {
    if (edge === 0) setStartDraft(raw)
    else setEndDraft(raw)

    if (!raw) {
      setInvalid(false)
      return
    }
    const ms = new Date(raw).getTime()
    if (Number.isNaN(ms)) return

    const snapped = nearestTimestampIndex(timestamps, ms)
    const next: [number, number] =
      edge === 0 ? [snapped, endIdx] : [startIdx, snapped]

    if (next[0] > next[1]) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onCommit(next)
  }

  const inputCls = cn(
    'h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'disabled:cursor-not-allowed disabled:opacity-50',
    invalid && 'border-destructive focus-visible:ring-destructive',
  )

  return (
    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
      <label className="space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          Start
        </span>
        <DateTimePicker
          value={startDraft}
          min={minBound}
          max={maxBound}
          disabled={disabled}
          onChange={e => handleChange(0, e)}
          className={inputCls}
        />
      </label>
      <label className="space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          End
        </span>
        <DateTimePicker
          value={endDraft}
          min={minBound}
          max={maxBound}
          disabled={disabled}
          onChange={e => handleChange(1, e)}
          className={inputCls}
        />
      </label>
      {invalid && (
        <p className="col-span-2 text-[11px] text-destructive">
          Start time must be on or before End time.
        </p>
      )}
    </div>
  )
}

export function DataCroppingChart({
  rawDataset,
  chartDataset,
  cropRange,
  onCropChange,
  valueCrop,
  onValueCropChange,
  scopeTag,
}: Props) {
  const timestamps = useMemo(
    () => rawDataset.rows.map(r => r.timestamp),
    [rawDataset],
  )
  const lastIdx = Math.max(0, timestamps.length - 1)

  // Single tag the Y crop keys to (scoped view = one series).
  const tag =
    scopeTag ??
    (chartDataset.tags.length === 1 ? chartDataset.tags[0] : undefined)
  const yCropEnabled = Boolean(tag)

  // Stable Y domain from the raw (uncropped) series so the axis doesn't jump
  // as the crop changes. 5% padding; ±1 fallback for a flat series.
  const yDomain = useMemo<[number, number]>(() => {
    if (!tag) return [0, 1]
    const vals: number[] = []
    for (const row of rawDataset.rows) {
      const cell = row.cells[tag]
      if (cell) vals.push(cell.value)
    }
    if (vals.length === 0) return [0, 1]
    let lo = Math.min(...vals)
    let hi = Math.max(...vals)
    if (lo === hi) {
      lo -= 1
      hi += 1
    } else {
      const pad = (hi - lo) * 0.05
      lo -= pad
      hi += pad
    }
    return [lo, hi]
  }, [rawDataset, tag])
  const [yMin, yMax] = yDomain

  // ── X (time) crop via slider — index range committed to cropRange ──
  const committed = useMemo<[number, number]>(() => {
    if (!cropRange) return [0, lastIdx]
    const from = timestamps.indexOf(cropRange.from)
    const to = timestamps.indexOf(cropRange.to)
    return [from === -1 ? 0 : from, to === -1 ? lastIdx : to]
  }, [cropRange, timestamps, lastIdx])

  const [range01, setRange01] = useState<[number, number]>(committed)
  useEffect(() => setRange01(committed), [committed])

  // Crop commits are confirmed first: staging a change opens the confirm dialog,
  // and the dialog's Apply runs the real onCropChange / onValueCropChange.
  const [pendingCrop, setPendingCrop] = useState<{
    range?: CropRange | null
    valueCrop?: ValueCrop
    summary: string
  } | null>(null)

  // Slider / time-input path: once the range settles off the committed window,
  // stage it for confirmation. Never re-stage while a dialog is already open.
  useEffect(() => {
    const [s, e] = range01
    if ((s === committed[0] && e === committed[1]) || pendingCrop) return
    const timer = setTimeout(() => {
      const range: CropRange | null =
        s <= 0 && e >= lastIdx
          ? null
          : timestamps[s] && timestamps[e]
            ? { from: timestamps[s]!, to: timestamps[e]! }
            : null
      setPendingCrop({
        range,
        summary: `Keeping ${e - s + 1} of ${timestamps.length} rows`,
      })
    }, COMMIT_MS)
    return () => clearTimeout(timer)
  }, [range01, committed, lastIdx, timestamps, pendingCrop])

  const chartRows = useMemo(() => toChartRows(chartDataset), [chartDataset])
  const [startIdx, endIdx] = range01
  const cropped = !(startIdx <= 0 && endIdx >= lastIdx)
  const disabled = timestamps.length < 2

  const activeValueCrop = tag ? valueCrop[tag] : undefined

  const tooltipLabels = useMemo<[string, string]>(
    () => [
      timestamps[startIdx] ? fmtTs(timestamps[startIdx]!) : '—',
      timestamps[endIdx] ? fmtTs(timestamps[endIdx]!) : '—',
    ],
    [timestamps, startIdx, endIdx],
  )

  // ── Drag-to-crop box (both axes) inside the chart ──
  const containerRef = useRef<HTMLDivElement | null>(null)
  const gridRectRef = useRef<DOMRect | null>(null)
  const [drag, setDrag] = useState<{
    startIdx: number
    startVal: number
    curIdx: number
    curVal: number
  } | null>(null)

  const color = tag
    ? chartColorVar(resolveTagMeta(tag).chartIndex)
    : 'var(--chart-1)'
  const config = useMemo<ChartConfig>(
    () => (tag ? { [tag]: { label: resolveTagMeta(tag).label, color } } : {}),
    [tag, color],
  )

  const readGridRect = () => {
    const el = containerRef.current?.querySelector('.recharts-cartesian-grid')
    gridRectRef.current = el ? el.getBoundingClientRect() : null
  }

  // Convert the cursor's viewport Y (event.clientY) into a data value using the
  // measured plot rect + the fixed Y domain. Uses the true cursor position (not
  // recharts' activeCoordinate, which snaps to the line) so the box drags freely
  // on the Y axis.
  const valueFromClientY = (clientY: number): number => {
    const rect = gridRectRef.current
    if (!rect || rect.height === 0) return yMax
    const t = clamp((clientY - rect.top) / rect.height, 0, 1) // 0 at top (=yMax), 1 at bottom (=yMin)
    return clamp(yMax - t * (yMax - yMin), yMin, yMax)
  }

  const commitDrag = () => {
    if (!drag) return
    const i1 = Math.min(drag.startIdx, drag.curIdx)
    const i2 = Math.max(drag.startIdx, drag.curIdx)
    const v1 = Math.min(drag.startVal, drag.curVal)
    const v2 = Math.max(drag.startVal, drag.curVal)
    const movedX = i2 - i1 >= 1
    const movedY = Math.abs(v2 - v1) > (yMax - yMin) * 0.02
    setDrag(null)
    if (!movedX && !movedY) return

    // Stage the drag result — the confirm dialog applies it. X crop only when a
    // real time span was dragged; Y crop only when a real value span was dragged.
    const next: {
      range?: CropRange | null
      valueCrop?: ValueCrop
      summary: string
    } = {
      summary: movedX
        ? `Keeping ${i2 - i1 + 1} of ${timestamps.length} rows`
        : 'Applying value crop to the selected range',
    }
    if (movedX) {
      next.range =
        i1 <= 0 && i2 >= lastIdx
          ? null
          : timestamps[i1] && timestamps[i2]
            ? { from: timestamps[i1]!, to: timestamps[i2]! }
            : null
    }
    if (movedY && tag) {
      next.valueCrop = { ...valueCrop, [tag]: { min: v1, max: v2 } }
    }
    setPendingCrop(next)
  }

  // Dialog actions: Apply commits the staged crop; Cancel drops it and reverts
  // the live slider preview back to the last committed window.
  const applyCrop = () => {
    if (!pendingCrop) return
    if (pendingCrop.range !== undefined) onCropChange(pendingCrop.range)
    if (pendingCrop.valueCrop) onValueCropChange(pendingCrop.valueCrop)
    setPendingCrop(null)
  }

  const cancelCrop = () => {
    setPendingCrop(null)
    setRange01(committed)
  }

  const clearValueCrop = () => {
    if (!tag || !valueCrop[tag]) return
    const next = { ...valueCrop }
    delete next[tag]
    onValueCropChange(next)
  }

  // Reset clears the crop immediately — no confirm. Commit directly (and sync
  // range01) so the staging effect sees range01 === committed and never opens
  // the dialog.
  const resetAll = () => {
    setPendingCrop(null)
    onCropChange(null)
    setRange01([0, lastIdx])
    clearValueCrop()
  }

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">
            Drag to Crop — Time &amp; Value
          </h2>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-mono text-muted-foreground">
            {timestamps[startIdx] ? fmtTs(timestamps[startIdx]!) : '—'}
            {' → '}
            {timestamps[endIdx] ? fmtTs(timestamps[endIdx]!) : '—'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={resetAll}
            disabled={disabled || (!cropped && !activeValueCrop)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MousePointerSquareDashed className="h-3.5 w-3.5" />
        Drag a box on the chart to crop both axes, or use the controls below.
      </div>

      {/* ── Interactive chart with drag-box selection ── */}
      <div ref={containerRef}>
        <ChartContainer
          config={config}
          style={{ height: CHART_H }}
          className="w-full select-none"
        >
          <LineChart
            data={chartRows}
            margin={{ left: 12, right: 12, top: 8, bottom: 0 }}
            onMouseDown={(state, e: React.MouseEvent) => {
              if (disabled) return
              const idx = state?.activeTooltipIndex
              if (typeof idx !== 'number') return
              readGridRect()
              const v = valueFromClientY(e.clientY)
              setDrag({ startIdx: idx, startVal: v, curIdx: idx, curVal: v })
            }}
            onMouseMove={(state, e: React.MouseEvent) => {
              if (!drag) return
              const idx = state?.activeTooltipIndex
              setDrag(d =>
                d
                  ? {
                      ...d,
                      curIdx: typeof idx === 'number' ? idx : d.curIdx,
                      curVal: valueFromClientY(e.clientY),
                    }
                  : d,
              )
            }}
            onMouseUp={commitDrag}
            onMouseLeave={() => setDrag(null)}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="timestamp"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              height={24}
              tickFormatter={value =>
                new Date(String(value)).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              }
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              domain={yDomain}
              allowDataOverflow
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={value =>
                    new Date(String(value)).toLocaleString()
                  }
                />
              }
            />

            {tag && (
              <Line
                dataKey={(row: SensorChartRow) => row[tag]}
                name={tag}
                type="natural"
                stroke={color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            )}

            {/* Committed crop window (kept region) */}
            {(cropped || activeValueCrop) && (
              <ReferenceArea
                x1={timestamps[startIdx]}
                x2={timestamps[endIdx]}
                y1={activeValueCrop ? activeValueCrop.min : undefined}
                y2={activeValueCrop ? activeValueCrop.max : undefined}
                fill="var(--primary)"
                fillOpacity={0.08}
                stroke="var(--primary)"
                strokeOpacity={0.4}
                strokeDasharray="4 4"
              />
            )}

            {/* Live drag selection */}
            {drag && (
              <ReferenceArea
                x1={timestamps[Math.min(drag.startIdx, drag.curIdx)]}
                x2={timestamps[Math.max(drag.startIdx, drag.curIdx)]}
                y1={Math.min(drag.startVal, drag.curVal)}
                y2={Math.max(drag.startVal, drag.curVal)}
                fill="var(--foreground)"
                fillOpacity={0.1}
                stroke="var(--foreground)"
                strokeOpacity={0.5}
              />
            )}
          </LineChart>
        </ChartContainer>
      </div>

      {/* ── Precise X (time) control ── */}
      <div className="px-1">
        <SliderWithTooltip
          min={0}
          max={lastIdx}
          step={1}
          value={range01}
          onValueChange={setRange01}
          disabled={disabled}
          tooltipLabels={tooltipLabels}
        />
        <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>
            {endIdx - startIdx + 1} of {timestamps.length} rows
          </span>
          {cropped && <span className="text-primary">time cropped</span>}
        </div>

        <CropTimeInputs
          timestamps={timestamps}
          startIdx={startIdx}
          endIdx={endIdx}
          disabled={disabled}
          onCommit={setRange01}
        />
      </div>

      {/* ── Precise Y (value) control ── */}
      {yCropEnabled && (
        <div className="space-y-1.5 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              Value crop (Y)
            </span>
            <Input
              type="number"
              inputMode="decimal"
              placeholder={`min ${yMin.toFixed(1)}`}
              value={activeValueCrop ? String(activeValueCrop.min) : ''}
              onChange={e => {
                if (!tag) return
                const min = parseFloat(e.target.value)
                const max = activeValueCrop?.max ?? yMax
                if (Number.isFinite(min))
                  onValueCropChange({ ...valueCrop, [tag]: { min, max } })
              }}
              className="h-8 w-24 text-xs"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="number"
              inputMode="decimal"
              placeholder={`max ${yMax.toFixed(1)}`}
              value={activeValueCrop ? String(activeValueCrop.max) : ''}
              onChange={e => {
                if (!tag) return
                const max = parseFloat(e.target.value)
                const min = activeValueCrop?.min ?? yMin
                if (Number.isFinite(max))
                  onValueCropChange({ ...valueCrop, [tag]: { min, max } })
              }}
              className="h-8 w-24 text-xs"
            />
            {activeValueCrop && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={clearValueCrop}
              >
                Clear
              </Button>
            )}
          </div>
          {scopeTag && (
            <p className="text-[11px] text-muted-foreground">
              Value crop drops rows where{' '}
              <span className="font-mono">{scopeTag}</span> falls outside the
              range (row-level, keyed to this tag).
            </p>
          )}
        </div>
      )}

      <AlertDialog
        open={pendingCrop !== null}
        onOpenChange={open => {
          if (!open) cancelCrop()
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Apply this crop?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCrop?.summary}. Rows outside the selection are removed for
              every downstream step.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={applyCrop}>
              Apply crop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
