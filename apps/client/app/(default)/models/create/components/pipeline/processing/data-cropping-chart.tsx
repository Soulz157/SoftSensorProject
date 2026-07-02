'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Scissors, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { toChartRows, type Dataset } from '@/lib/preprocessing'
import type { CropRange } from '@/lib/precleanse'
import type { TimeRange } from '@/lib/mock-readings'
import { RawTrendChart } from '../../chart/raw-data-chart'
import { cn } from '@/lib/utils'

interface Props {
  rawDataset: Dataset
  chartDataset: Dataset
  range: TimeRange
  cropRange: CropRange
  onCropChange: (range: CropRange) => void
}

const COMMIT_MS = 300

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
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

export function DataCroppingChart({
  rawDataset,
  chartDataset,
  range,
  cropRange,
  onCropChange,
}: Props) {
  const timestamps = useMemo(
    () => rawDataset.rows.map(r => r.timestamp),
    [rawDataset],
  )
  const lastIdx = Math.max(0, timestamps.length - 1)

  const committed = useMemo<[number, number]>(() => {
    if (!cropRange) return [0, lastIdx]
    const from = timestamps.indexOf(cropRange.from)
    const to = timestamps.indexOf(cropRange.to)
    return [from === -1 ? 0 : from, to === -1 ? lastIdx : to]
  }, [cropRange, timestamps, lastIdx])

  const [range01, setRange01] = useState<[number, number]>(committed)
  useEffect(() => setRange01(committed), [committed])

  useEffect(() => {
    const [s, e] = range01
    const timer = setTimeout(() => {
      if (s <= 0 && e >= lastIdx) {
        onCropChange(null)
      } else {
        const from = timestamps[s]
        const to = timestamps[e]
        if (from && to) onCropChange({ from, to })
      }
    }, COMMIT_MS)
    return () => clearTimeout(timer)
  }, [range01, lastIdx, timestamps, onCropChange])

  const chartRows = useMemo(() => toChartRows(chartDataset), [chartDataset])
  const [startIdx, endIdx] = range01
  const cropped = !(startIdx <= 0 && endIdx >= lastIdx)
  const disabled = timestamps.length < 2

  const tooltipLabels = useMemo<[string, string]>(
    () => [
      timestamps[startIdx] ? fmtTs(timestamps[startIdx]!) : '—',
      timestamps[endIdx] ? fmtTs(timestamps[endIdx]!) : '—',
    ],
    [timestamps, startIdx, endIdx],
  )

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            Time Range Cropping
          </p>
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
            onClick={() => setRange01([0, lastIdx])}
            disabled={disabled || !cropped}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </div>

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
          {cropped && <span className="text-primary">cropped</span>}
        </div>
      </div>

      <RawTrendChart rows={chartRows} tags={chartDataset.tags} range={range} />
    </div>
  )
}
