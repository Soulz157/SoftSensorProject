'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Scissors,
  RotateCcw,
  MousePointerSquareDashed,
  CalendarClock,
  Eraser,
  Crop,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
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
  type RangeExclusion,
} from '@/lib/precleanse'
import { DateTimePicker, toDateTimeLocal } from '@/components/ui/Datetime'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
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
  scopeTag?: string
  onExcludeRange?: (exclusion: RangeExclusion) => void
  /** Committed exclusion bands to render on the chart. */
  exclusions?: RangeExclusion[]
  onClearExclusions?: () => void
}

const COMMIT_MS = 300
const CHART_H = 480

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

// ── Component สำหรับช่อง Input Start/End Date ──
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
          Start Time
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
          End Time
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
  onExcludeRange,
  exclusions = [],
  onClearExclusions,
}: Props) {
  const timestamps = useMemo(
    () => rawDataset.rows.map(r => r.timestamp),
    [rawDataset],
  )
  const lastIdx = Math.max(0, timestamps.length - 1)

  const tag =
    scopeTag ??
    (chartDataset.tags.length === 1 ? chartDataset.tags[0] : undefined)

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

  const committed = useMemo<[number, number]>(() => {
    if (!cropRange) return [0, lastIdx]
    const from = timestamps.indexOf(cropRange.from)
    const to = timestamps.indexOf(cropRange.to)
    return [from === -1 ? 0 : from, to === -1 ? lastIdx : to]
  }, [cropRange, timestamps, lastIdx])

  const [range01, setRange01] = useState<[number, number]>(committed)
  useEffect(() => setRange01(committed), [committed])

  const [pendingCrop, setPendingCrop] = useState<{
    range?: CropRange | null
    valueCrop?: ValueCrop
    mode?: 'crop' | 'exclude'
    summary: string
    selection?: {
      startIdx: number
      endIdx: number
      valueMin: number
      valueMax: number
      movedX: boolean
      movedY: boolean
    }
  } | null>(null)

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

  // ── Drag-to-crop logic ──
  const containerRef = useRef<HTMLDivElement | null>(null)
  const gridRectRef = useRef<DOMRect | null>(null)
  const [isInside, setIsInside] = useState(false)
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

  const readGridRect = useCallback(() => {
    const el = containerRef.current?.querySelector('.recharts-cartesian-grid')
    if (el) {
      gridRectRef.current = el.getBoundingClientRect()
    }
  }, [])

  // คำนวณแกน X จาก Pixel หน้าจอตรงๆ แก้อาการ 20px offset เลื่อน
  const indexFromClientX = useCallback(
    (clientX: number): number => {
      const rect = gridRectRef.current
      if (!rect || rect.width === 0) return 0
      const t = clamp((clientX - rect.left) / rect.width, 0, 1)
      const maxIdx = timestamps.length - 1
      return clamp(Math.round(t * maxIdx), 0, maxIdx)
    },
    [timestamps.length],
  )

  // คำนวณแกน Y
  const valueFromClientY = useCallback(
    (clientY: number): number => {
      const rect = gridRectRef.current
      if (!rect || rect.height === 0) return yMax
      const t = clamp((clientY - rect.top) / rect.height, 0, 1)
      return clamp(yMax - t * (yMax - yMin), yMin, yMax)
    },
    [yMax, yMin],
  )

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

    const parts: string[] = []
    if (movedX) parts.push(`${i2 - i1 + 1} of ${timestamps.length} rows`)

    setPendingCrop({
      mode: cropMode,
      summary: parts.length
        ? `Selected ${parts.join(' · ')}`
        : 'Selected range',
      selection: {
        startIdx: i1,
        endIdx: i2,
        valueMin: v1,
        valueMax: v2,
        movedX,
        movedY,
      },
    })
  }

  const applyKeep = () => {
    if (!pendingCrop) return

    let range = pendingCrop.range
    let nextValueCrop = pendingCrop.valueCrop

    const sel = pendingCrop.selection
    if (sel) {
      if (sel.movedX) {
        range =
          sel.startIdx <= 0 && sel.endIdx >= lastIdx
            ? null
            : timestamps[sel.startIdx] && timestamps[sel.endIdx]
              ? { from: timestamps[sel.startIdx]!, to: timestamps[sel.endIdx]! }
              : null
      }
      if (sel.movedY && tag) {
        nextValueCrop = {
          ...valueCrop,
          [tag]: { min: sel.valueMin, max: sel.valueMax },
        }
      }
    }

    if (range !== undefined) {
      onCropChange(range)
      const sIdx = range ? timestamps.indexOf(range.from) : 0
      const eIdx = range ? timestamps.indexOf(range.to) : lastIdx
      setRange01([sIdx > -1 ? sIdx : 0, eIdx > -1 ? eIdx : lastIdx])
    }
    if (nextValueCrop) onValueCropChange(nextValueCrop)
    setPendingCrop(null)
  }

  const applyExclude = () => {
    const sel = pendingCrop?.selection
    if (!sel) {
      setPendingCrop(null)
      return
    }
    const time =
      sel.movedX && timestamps[sel.startIdx] && timestamps[sel.endIdx]
        ? { from: timestamps[sel.startIdx]!, to: timestamps[sel.endIdx]! }
        : null
    const value =
      sel.movedY && tag ? { tag, min: sel.valueMin, max: sel.valueMax } : null

    onExcludeRange?.({ time, value })
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

  const resetAll = () => {
    setPendingCrop(null)
    onCropChange(null)
    setRange01([0, lastIdx])
    clearValueCrop()
    onClearExclusions?.()
  }

  const [cropMode, setCropMode] = useState<'crop' | 'exclude'>('crop')
  const canExclude = !!onExcludeRange
  const pendingMode = pendingCrop?.mode ?? 'crop'
  const isExclude = pendingMode === 'exclude'
  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">
            Trim Data Range
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
            disabled={
              disabled ||
              (!cropped && !activeValueCrop && exclusions.length === 0)
            }
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </div>

      {/* ── Method 1: Drag to Crop (visual head/tail trim) ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MousePointerSquareDashed className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-xs font-semibold text-foreground">
            Drag to Select
          </h3>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            {cropMode === 'exclude'
              ? 'Drag a box to cut that span out of the data.'
              : 'Drag a box to keep only the head/tail (and value range).'}
          </span>
        </div>

        {canExclude && (
          <div className="inline-flex items-center rounded-lg border border-border bg-background p-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={cropMode === 'crop'}
              onClick={() => setCropMode('crop')}
              className={cn(
                'h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium',
                cropMode === 'crop'
                  ? 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary'
                  : 'text-foreground hover:bg-primary/10 hover:text-primary',
              )}
            >
              <Crop className="h-3.5 w-3.5" />
              Crop
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={cropMode === 'exclude'}
              onClick={() => setCropMode('exclude')}
              className={cn(
                'h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium',
                cropMode === 'exclude'
                  ? 'bg-destructive/10 text-destructive hover:bg-destructive/10 hover:text-destructive'
                  : 'text-foreground hover:bg-destructive/10 hover:text-destructive',
              )}
            >
              <Eraser className="h-3.5 w-3.5" />
              Exclude
            </Button>
          </div>
        )}
      </div>

      <div ref={containerRef} className="pt-2">
        <ChartContainer
          config={config}
          style={{ height: CHART_H }}
          className="w-full select-none cursor-crosshair"
        >
          <LineChart
            data={chartRows}
            margin={{ left: 12, right: 12, top: 8, bottom: 0 }}
            onMouseEnter={() => {
              setIsInside(true)
              readGridRect()
            }}
            onMouseDown={(state, e: React.MouseEvent) => {
              if (disabled) return
              readGridRect()
              // ใช้ฟังก์ชัน indexFromClientX แทน Recharts's activeTooltipIndex
              const idx = indexFromClientX(e.clientX)
              const v = valueFromClientY(e.clientY)
              setDrag({ startIdx: idx, startVal: v, curIdx: idx, curVal: v })
            }}
            onMouseMove={(state, e: React.MouseEvent) => {
              if (!drag || !isInside) return
              const idx = indexFromClientX(e.clientX)
              const v = valueFromClientY(e.clientY)
              setDrag(d => (d ? { ...d, curIdx: idx, curVal: v } : d))
            }}
            onMouseUp={commitDrag}
            onMouseLeave={() => {
              setIsInside(false)
              if (drag) commitDrag()
              else setDrag(null)
            }}
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
              width={75}
              domain={yDomain}
              tickFormatter={value =>
                Number(value).toLocaleString(undefined, {
                  maximumFractionDigits: 4,
                })
              }
            />
            <ChartTooltip
              wrapperStyle={{ pointerEvents: 'none' }}
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

            {/* Committed exclusion bands (remove-inside spans). */}
            {exclusions.map((ex, i) =>
              ex.time ? (
                <ReferenceArea
                  key={`ex-${i}-${ex.time.from}`}
                  x1={ex.time.from}
                  x2={ex.time.to}
                  y1={ex.value ? ex.value.min : undefined}
                  y2={ex.value ? ex.value.max : undefined}
                  fill="var(--destructive)"
                  fillOpacity={0.1}
                  stroke="var(--destructive)"
                  strokeOpacity={0.4}
                  strokeDasharray="4 4"
                />
              ) : null,
            )}

            {drag && (
              <ReferenceArea
                x1={timestamps[Math.min(drag.startIdx, drag.curIdx)]}
                x2={timestamps[Math.max(drag.startIdx, drag.curIdx)]}
                y1={Math.min(drag.startVal, drag.curVal)}
                y2={Math.max(drag.startVal, drag.curVal)}
                fill={
                  cropMode === 'exclude'
                    ? 'var(--destructive)'
                    : 'var(--foreground)'
                }
                fillOpacity={0.1}
                stroke={
                  cropMode === 'exclude'
                    ? 'var(--destructive)'
                    : 'var(--foreground)'
                }
                strokeOpacity={0.5}
              />
            )}
          </LineChart>
        </ChartContainer>
      </div>

      {/* ── Method 2: Time Crop (absolute timestamp range) ── */}
      <div className="border-t border-border/60 px-1 pt-3">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <CalendarClock className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-xs font-semibold text-foreground">Time Crop</h3>
          <span className="text-[11px] text-muted-foreground">
            Crop strictly by an absolute start / end timestamp.
          </span>
        </div>
        <CropTimeInputs
          timestamps={timestamps}
          startIdx={startIdx}
          endIdx={endIdx}
          disabled={disabled}
          onCommit={setRange01}
        />
      </div>

      <AlertDialog
        open={pendingCrop !== null}
        onOpenChange={open => {
          if (!open) cancelCrop()
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isExclude ? 'Remove this selection?' : 'Apply this crop?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {pendingCrop?.summary}.{' '}
              {isExclude
                ? 'These rows are dropped from the data; everything outside stays. This can be undone.'
                : 'Rows outside the selection are removed for every downstream step.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={cancelCrop}
              className="sm:mr-auto"
            >
              Cancel
            </Button>
            {isExclude ? (
              <Button variant="destructive" onClick={applyExclude}>
                Remove Selection
              </Button>
            ) : (
              <Button onClick={applyKeep}>Apply crop</Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
