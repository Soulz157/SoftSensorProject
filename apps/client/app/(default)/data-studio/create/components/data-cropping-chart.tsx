'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Scissors,
  RotateCcw,
  MousePointerSquareDashed,
  CalendarClock,
  Eraser,
  Crop,
  ChevronsDownUp,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
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
  clipImpact,
  percentileBounds,
  type CropRange,
  type ValueCrop,
  type ValueClip,
  type ClipImpact,
  type RangeExclusion,
} from '@/lib/precleanse'
import { DateTimePicker, toDateTimeLocal } from '@/components/date-time-picker'
import {
  AlertDialog,
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
  scopeTag?: string
  onExcludeRange?: (exclusion: RangeExclusion) => void
  /**
   * Per-tag winsorize bounds. ไม่ส่ง `onValueClipChange` มา = ปุ่ม Clip ไม่แสดง
   * (component เก็บ state เองไม่ได้ เพราะ clip ต้องไปเป็น stage ใน `precleanse`)
   */
  valueClip?: ValueClip
  onValueClipChange?: (clip: ValueClip) => void
  /**
   * Dataset ที่ clip stage จะทำงานบนจริง = ผลของ `precleanse` โดยละ `valueClip`
   * ออก. ใช้เป็นฐานนับ impact และคำนวณ percentile ให้ตรงกับผลจริง.
   *
   * ไม่ส่งมาจะ fallback เป็น `rawDataset` ซึ่ง **overstate** ถ้ามี crop /
   * exclude / outlier rule active อยู่ เพราะ clip เป็น stage สุดท้าย จึงเห็น
   * เฉพาะ row ที่รอดจาก stage ก่อนหน้า
   */
  clipBasis?: Dataset
  /** Committed exclusion bands to render on the chart. */
  exclusions?: RangeExclusion[]
  onClearExclusions?: () => void
}

type Mode = 'crop' | 'exclude' | 'clip'

const COMMIT_MS = 300
const CHART_H = 480
/** ต้องลากแนวตั้งเกินสัดส่วนนี้ของแกน Y จึงนับว่าเลือกช่วงค่า */
const Y_DRAG_THRESHOLD = 0.02

const CLIP_PRESETS = [
  [20, 80],
  [10, 90],
  [5, 95],
  [1, 99],
] as const

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

interface DragSelection {
  startIdx: number
  endIdx: number
  valueMin: number
  valueMax: number
  movedX: boolean
  movedY: boolean
}

interface PendingAction {
  mode: Mode
  summary: string
  /** slider / time-input path เท่านั้น — drag path ใช้ `selection` */
  range?: CropRange | null
  impact?: ClipImpact
  selection?: DragSelection
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
  valueClip = {},
  onValueClipChange,
  clipBasis,
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

  const [cropMode, setCropMode] = useState<Mode>('crop')
  const canExclude = !!onExcludeRange
  const showClip = !!onValueClipChange
  const canClip = showClip && !!tag

  useEffect(() => {
    if (cropMode === 'clip' && !canClip) setCropMode('crop')
    else if (cropMode === 'exclude' && !canExclude) setCropMode('crop')
  }, [cropMode, canClip, canExclude])

  const clipSource = clipBasis ?? rawDataset
  const clipBasisIsApprox = !clipBasis

  const indexByTs = useMemo(() => {
    if (!cropRange) return null
    const m = new Map<string, number>()
    for (let i = timestamps.length - 1; i >= 0; i--) m.set(timestamps[i]!, i)
    return m
  }, [timestamps, cropRange])

  const yDomain = useMemo<[number, number]>(() => {
    if (!tag) return [0, 1]
    let lo = Infinity
    let hi = -Infinity
    for (const row of rawDataset.rows) {
      const v = row.cells[tag]?.value
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (lo === Infinity) return [0, 1]
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
    const from = indexByTs?.get(cropRange.from)
    const to = indexByTs?.get(cropRange.to)
    return [from ?? 0, to ?? lastIdx]
  }, [cropRange, indexByTs, lastIdx])

  const [range01, setRange01] = useState<[number, number]>(committed)
  useEffect(() => setRange01(committed), [committed])

  const [pending, setPending] = useState<PendingAction | null>(null)

  useEffect(() => {
    const [s, e] = range01
    if ((s === committed[0] && e === committed[1]) || pending) return
    const timer = setTimeout(() => {
      const range: CropRange | null =
        s <= 0 && e >= lastIdx
          ? null
          : timestamps[s] && timestamps[e]
            ? { from: timestamps[s]!, to: timestamps[e]! }
            : null
      setPending({
        mode: 'crop',
        range,
        summary: `Keeping ${e - s + 1} of ${timestamps.length} rows`,
      })
    }, COMMIT_MS)
    return () => clearTimeout(timer)
  }, [range01, committed, lastIdx, timestamps, pending])

  const chartRows = useMemo(() => toChartRows(chartDataset), [chartDataset])
  const [startIdx, endIdx] = range01
  const cropped = !(startIdx <= 0 && endIdx >= lastIdx)
  const disabled = timestamps.length < 2

  const activeValueCrop = tag ? valueCrop[tag] : undefined
  const activeClip = tag ? valueClip[tag] : undefined

  // ── Drag-to-select ──
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
    if (el) gridRectRef.current = el.getBoundingClientRect()
  }, [])

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

  const valueFromClientY = useCallback(
    (clientY: number): number => {
      const rect = gridRectRef.current
      if (!rect || rect.height === 0) return yMax
      const t = clamp((clientY - rect.top) / rect.height, 0, 1)
      return clamp(yMax - t * (yMax - yMin), yMin, yMax)
    },
    [yMax, yMin],
  )

  /** selection indices -> CropRange. ใช้ index ที่มีอยู่ ไม่ค้นหากลับ
   *  full range คืน null = "ไม่มี crop" ตาม convention ของ onCropChange */
  const rangeFromIndices = useCallback(
    (s: number, e: number): CropRange => {
      if (s <= 0 && e >= lastIdx) return null
      const from = timestamps[s]
      const to = timestamps[e]
      return from && to ? { from, to } : null
    },
    [timestamps, lastIdx],
  )

  const clipSummary = (impact: ClipImpact): string =>
    impact.total === 0
      ? 'No readings fall outside this band — nothing would change'
      : `Clamping ${impact.total.toLocaleString()} of ` +
        `${impact.points.toLocaleString()} readings ` +
        `(${impact.below.toLocaleString()} below, ` +
        `${impact.above.toLocaleString()} above)`

  const commitDrag = () => {
    if (!drag) return
    const i1 = Math.min(drag.startIdx, drag.curIdx)
    const i2 = Math.max(drag.startIdx, drag.curIdx)
    const v1 = Math.min(drag.startVal, drag.curVal)
    const v2 = Math.max(drag.startVal, drag.curVal)
    const movedX = i2 - i1 >= 1
    const movedY = Math.abs(v2 - v1) > (yMax - yMin) * Y_DRAG_THRESHOLD
    setDrag(null)

    if (cropMode === 'clip') {
      if (!movedY || !tag) return
      const impact = clipImpact(clipSource, tag, v1, v2)
      setPending({
        mode: 'clip',
        impact,
        summary: clipSummary(impact),
        selection: {
          startIdx: 0,
          endIdx: lastIdx,
          valueMin: v1,
          valueMax: v2,
          movedX: false,
          movedY: true,
        },
      })
      return
    }

    if (!movedX && !movedY) return

    const parts: string[] = []
    if (movedX) parts.push(`${i2 - i1 + 1} of ${timestamps.length} rows`)

    setPending({
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

  const applyPresetClip = (loPct: number, hiPct: number) => {
    if (!tag || !onValueClipChange) return
    const bound = percentileBounds(clipSource, tag, loPct, hiPct)
    if (!bound) return
    const impact = clipImpact(clipSource, tag, bound.min, bound.max)
    setPending({
      mode: 'clip',
      impact,
      summary:
        `P${loPct}–P${hiPct} → [${bound.min.toFixed(3)}, ${bound.max.toFixed(3)}]. ` +
        clipSummary(impact),
      selection: {
        startIdx: 0,
        endIdx: lastIdx,
        valueMin: bound.min,
        valueMax: bound.max,
        movedX: false,
        movedY: true,
      },
    })
  }

  /**
   * ทางออกเดียวของทุก mode. เดิมแยกเป็น applyKeep / applyExclude / applyClip
   * ที่ใช้ sentinel convention ต่างกัน (`range !== undefined` vs truthiness)
   * ซึ่งเป็นกับดักเวลาเพิ่ม mode ใหม่
   */
  const commitPending = () => {
    const p = pending
    if (!p) return
    const sel = p.selection

    switch (p.mode) {
      // ── Clip: transform ค่า ไม่แตะ row ──
      case 'clip': {
        if (sel?.movedY && tag && onValueClipChange) {
          onValueClipChange({
            ...valueClip,
            [tag]: { min: sel.valueMin, max: sel.valueMax },
          })
        }
        break
      }

      // ── Exclude: ทิ้งสิ่งที่อยู่ในช่วง ──
      case 'exclude': {
        const time = sel?.movedX
          ? rangeFromIndices(sel.startIdx, sel.endIdx)
          : null
        const value =
          sel?.movedY && tag
            ? { tag, min: sel.valueMin, max: sel.valueMax }
            : null
        // ไม่มีแกนไหนเลย = ไม่มีอะไรให้ทิ้ง. ถ้ายิงต่อ exclusions จะโตด้วย
        // entry เปล่าที่ render ไม่ออกแต่ทำให้ปุ่ม Reset enable ค้าง
        if (time || value) onExcludeRange?.({ time, value })
        break
      }

      // ── Crop: เก็บสิ่งที่อยู่ในช่วง ──
      default: {
        if (sel) {
          if (sel.movedX) {
            onCropChange(rangeFromIndices(sel.startIdx, sel.endIdx))
            // ใช้ index ที่มีอยู่ ไม่ indexOf กลับ (O(n) และผิดถ้า ts ซ้ำ)
            setRange01([sel.startIdx, sel.endIdx])
          }
          if (sel.movedY && tag) {
            onValueCropChange({
              ...valueCrop,
              [tag]: { min: sel.valueMin, max: sel.valueMax },
            })
          }
        } else if (p.range !== undefined) {
          // slider / time-input path — range01 เป็นตัว trigger effect อยู่แล้ว
          onCropChange(p.range)
        }
        break
      }
    }

    setPending(null)
  }

  const cancelPending = () => {
    setPending(null)
    setRange01(committed)
  }

  const clearValueCrop = () => {
    if (!tag || !valueCrop[tag]) return
    const next = { ...valueCrop }
    delete next[tag]
    onValueCropChange(next)
  }

  const clearClip = () => {
    if (!tag || !valueClip[tag] || !onValueClipChange) return
    const next = { ...valueClip }
    delete next[tag]
    onValueClipChange(next)
  }

  const resetAll = () => {
    setPending(null)
    onCropChange(null)
    setRange01([0, lastIdx])
    clearValueCrop()
    clearClip()
    onClearExclusions?.()
  }

  const isExclude = pending?.mode === 'exclude'
  const isClip = pending?.mode === 'clip'
  /** ลาก Y ไว้แต่ไม่มี tag scope -> ส่วน Y จะถูกทิ้ง ต้องบอก user */
  const yIgnored = !!pending?.selection?.movedY && !tag && !isClip

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
              (!cropped &&
                !activeValueCrop &&
                !activeClip &&
                exclusions.length === 0)
            }
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </div>

      {/* ── Method 1: Drag to select ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MousePointerSquareDashed className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-xs font-semibold text-foreground">
            Drag to Select
          </h3>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            {cropMode === 'exclude'
              ? 'Drag a box to cut that span out of the data.'
              : cropMode === 'clip'
                ? 'Drag vertically to set a band — outside values are pulled to the edges, no rows removed.'
                : 'Drag a box to keep only the head/tail (and value range).'}
          </span>
        </div>

        {/* Clip ไม่ผูกกับ canExclude แล้ว — แยกเงื่อนไขต่อปุ่ม */}
        {(canExclude || showClip) && (
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

            {canExclude && (
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
            )}

            {showClip && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canClip}
                aria-pressed={cropMode === 'clip'}
                onClick={() => setCropMode('clip')}
                title={
                  canClip
                    ? 'Clamp values outside the band to the band edges'
                    : 'Scope the chart to a single tag to clip'
                }
                className={cn(
                  'h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium',
                  cropMode === 'clip'
                    ? 'bg-chart-4/15 text-chart-4 hover:bg-chart-4/15 hover:text-chart-4'
                    : 'text-foreground hover:bg-chart-4/15 hover:text-chart-4',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <ChevronsDownUp className="h-3.5 w-3.5" />
                Clip
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Percentile presets — แถวของตัวเอง ไม่แย่งพื้นที่ใน justify-between */}
      {cropMode === 'clip' && canClip && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-chart-4/5 px-2.5 py-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            Percentile presets
          </span>
          {CLIP_PRESETS.map(([lo, hi]) => (
            <Button
              key={`${lo}-${hi}`}
              size="sm"
              variant="outline"
              className="h-6 px-2 font-mono text-[11px]"
              onClick={() => applyPresetClip(lo, hi)}
              disabled={disabled}
            >
              P{lo}–P{hi}
            </Button>
          ))}
          {activeClip && (
            <>
              <span className="ml-auto font-mono text-[11px] text-chart-4">
                clipped to [{activeClip.min.toFixed(3)},{' '}
                {activeClip.max.toFixed(3)}]
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={clearClip}
              >
                Clear
              </Button>
            </>
          )}
        </div>
      )}

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

            {/* Clip band: แถบทึบ = โซนที่ค่าถูกดึงเข้ามาที่ขอบ */}
            {activeClip && (
              <>
                <ReferenceArea
                  y1={yMin}
                  y2={activeClip.min}
                  fill="var(--chart-4)"
                  fillOpacity={0.12}
                  stroke="none"
                />
                <ReferenceArea
                  y1={activeClip.max}
                  y2={yMax}
                  fill="var(--chart-4)"
                  fillOpacity={0.12}
                  stroke="none"
                />
                <ReferenceLine
                  y={activeClip.min}
                  stroke="var(--chart-4)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.8}
                />
                <ReferenceLine
                  y={activeClip.max}
                  stroke="var(--chart-4)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.8}
                />
              </>
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
                // clip = band เต็มความกว้าง เพราะ winsorize ไม่ผูกกับเวลา
                x1={
                  cropMode === 'clip'
                    ? undefined
                    : timestamps[Math.min(drag.startIdx, drag.curIdx)]
                }
                x2={
                  cropMode === 'clip'
                    ? undefined
                    : timestamps[Math.max(drag.startIdx, drag.curIdx)]
                }
                y1={Math.min(drag.startVal, drag.curVal)}
                y2={Math.max(drag.startVal, drag.curVal)}
                fill={
                  cropMode === 'exclude'
                    ? 'var(--destructive)'
                    : cropMode === 'clip'
                      ? 'var(--chart-4)'
                      : 'var(--foreground)'
                }
                fillOpacity={0.1}
                stroke={
                  cropMode === 'exclude'
                    ? 'var(--destructive)'
                    : cropMode === 'clip'
                      ? 'var(--chart-4)'
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
        open={pending !== null}
        onOpenChange={open => {
          if (!open) cancelPending()
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isExclude
                ? 'Remove this selection?'
                : isClip
                  ? 'Clamp values to this band?'
                  : 'Apply this crop?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {pending?.summary}.{' '}
              {isExclude
                ? 'These rows are dropped from the data; everything outside stays. This can be undone.'
                : isClip
                  ? 'No rows are removed — readings outside the band are set to the nearest edge value. The original readings are replaced for every downstream step. This can be undone.'
                  : 'Rows outside the selection are removed for every downstream step.'}
            </AlertDialogDescription>

            {yIgnored && (
              <p className="mt-2 rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                A value range needs a single tag in scope — only the time range
                will be applied.
              </p>
            )}

            {isClip &&
              clipBasisIsApprox &&
              (cropped || exclusions.length > 0) && (
                <p className="mt-2 rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                  Counts are based on the full raw series. A crop or exclusion
                  is active, so the actual number clamped will be lower.
                </p>
              )}

            {isClip && activeValueCrop && (
              <p className="mt-2 rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                A value crop is already active on this tag. Value crop deletes
                out-of-range rows, clip keeps and clamps them — combining both
                means the crop removes the rows before clip can reach them.
                Clear the value crop if clamping is what you want.
              </p>
            )}
          </AlertDialogHeader>

          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={cancelPending}
              className="sm:mr-auto"
            >
              Cancel
            </Button>
            {isExclude ? (
              <Button variant="destructive" onClick={commitPending}>
                Remove Selection
              </Button>
            ) : isClip ? (
              <Button
                onClick={commitPending}
                disabled={pending?.impact?.total === 0}
              >
                Clamp values
              </Button>
            ) : (
              <Button onClick={commitPending}>Apply crop</Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
