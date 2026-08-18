'use client'

import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { LineChart, CartesianGrid, XAxis, YAxis, Line } from 'recharts'
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'
import {
  rangeConfig,
  resolveTagMeta,
  chartColorVar,
  type TimeRange,
} from '@/lib/mock-readings'
import type { TagFillPreviewRow } from '@/lib/preprocessing'
import { SegmentedToggle } from '@/app/(default)/data-visualize/components/segmented-toggle'

interface Props {
  rows: TagFillPreviewRow[]
  tags: string[]
  isolatedTag: string
  onIsolate: (tag: string) => void
  range: TimeRange
}

type View = 'original' | 'cleaned' | 'overlay'

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'cleaned', label: 'Cleaned' },
  { value: 'overlay', label: 'Overlay Both' },
]

const X_ZOOM_STEP = 1.6
const MIN_VISIBLE_POINTS = 8
const RENDER_BUDGET = 600
const ANIMATE_MAX_POINTS = 200
const SPLINE_MAX_POINTS = 200
const MAX_POINTS_FOR_DOTS = 120

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

function decimateRange(
  rows: TagFillPreviewRow[],
  buckets: number,
  start: number,
  end: number,
): TagFillPreviewRow[] {
  const n = end - start
  if (n <= 0) return []
  if (n <= buckets * 2) return rows.slice(start, end)

  const size = n / buckets
  const keep = new Set<number>([start, end - 1])

  for (let b = 0; b < buckets; b++) {
    const lo = start + Math.floor(b * size)
    const hi = Math.min(end, start + Math.floor((b + 1) * size))
    for (const key of ['before', 'after'] as const) {
      let minI = -1
      let maxI = -1
      let minV = Infinity
      let maxV = -Infinity
      for (let i = lo; i < hi; i++) {
        const v = rows[i]![key]
        if (!isNum(v)) continue
        if (v < minV) {
          minV = v
          minI = i
        }
        if (v > maxV) {
          maxV = v
          maxI = i
        }
      }
      if (minI >= 0) keep.add(minI)
      if (maxI >= 0) keep.add(maxI)
    }
  }

  // ขอบของทุก gap ใน `before` — ต้องมี ไม่ใช่ nice-to-have
  for (let i = start; i < end; i++) {
    const cur = isNum(rows[i]!.before)
    const prev = i > start ? isNum(rows[i - 1]!.before) : cur
    if (cur !== prev) {
      keep.add(i - 1)
      keep.add(i)
    }
  }

  return [...keep]
    .filter(i => i >= start && i < end)
    .sort((a, b) => a - b)
    .map(i => rows[i]!)
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}

export function ImputationTrendChart({
  rows,
  tags,
  isolatedTag,
  onIsolate,
  range,
}: Props) {
  const reducedMotion = usePrefersReducedMotion()
  const { tickFormat } = rangeConfig(range)
  const [view, setView] = useState<View>('overlay')

  const [zoomWindow, setZoomWindow] = useState<[number, number] | null>(null)

  // reset เมื่อชุดข้อมูลใหม่มา ไม่ใช่เมื่อ array reference เปลี่ยน
  const dataKey = rows.length
    ? `${rows.length}|${rows[0]!.timestamp}|${rows[rows.length - 1]!.timestamp}`
    : '0'
  useEffect(() => {
    setZoomWindow(null)
  }, [dataKey])

  // เปลี่ยน tag ที่ isolate = ข้อมูลคนละชุด window เดิมไม่มีความหมาย
  useEffect(() => {
    setZoomWindow(null)
  }, [isolatedTag])

  const zoomBy = (factor: number) => {
    setZoomWindow(prev => {
      const len = rows.length
      if (len === 0) return prev
      const [s, e] = prev ?? [0, len - 1]
      const span = e - s + 1
      const nextSpan = Math.max(
        Math.min(MIN_VISIBLE_POINTS, len),
        Math.min(len, Math.round(span / factor)),
      )
      const center = (s + e) / 2
      const ns = Math.max(
        0,
        Math.min(len - nextSpan, Math.round(center - nextSpan / 2)),
      )
      return ns === 0 && nextSpan === len ? null : [ns, ns + nextSpan - 1]
    })
  }
  const zoomIn = () => zoomBy(X_ZOOM_STEP)
  const zoomOut = () => zoomBy(1 / X_ZOOM_STEP)

  const panBy = (fraction: number) => {
    setZoomWindow(prev => {
      if (!prev) return prev
      const len = rows.length
      const [s, e] = prev
      const span = e - s + 1
      const ns = Math.max(
        0,
        Math.min(len - span, s + Math.round(span * fraction)),
      )
      return [ns, ns + span - 1]
    })
  }
  const [fitY, setFitY] = useState(false)

  /** Domain ครอบทั้ง before + after ของ rows ทั้งก้อน — คงที่ตลอด ไม่ว่าจะ zoom
   *  ไปช่วงไหนหรือสลับ view ไหน สองอย่างที่ chart นี้ต้องเทียบกันตรง ๆ
   *  คำนวณครั้งเดียวต่อ rows ไม่ใช่ต่อ window */
  const fullYDomain = useMemo<[number, number] | null>(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const r of rows) {
      for (const v of [r.before, r.after]) {
        if (!isNum(v)) continue
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
    if (lo > hi) return null
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.05
    return [lo - pad, hi + pad]
  }, [rows])

  const w0 = zoomWindow?.[0] ?? 0
  const w1 = zoomWindow?.[1] ?? rows.length - 1
  const visibleCount = rows.length ? w1 - w0 + 1 : 0
  const isZoomed = zoomWindow !== null

  const deferredWindow = useDeferredValue(zoomWindow)
  const plotRows = useMemo(() => {
    const s = deferredWindow?.[0] ?? 0
    const e = (deferredWindow?.[1] ?? rows.length - 1) + 1
    return decimateRange(
      rows,
      Math.max(64, Math.floor(RENDER_BUDGET / 2)),
      s,
      Math.max(s, e),
    )
  }, [rows, deferredWindow])

  const isStale = deferredWindow !== zoomWindow
  const heavy = plotRows.length > ANIMATE_MAX_POINTS
  const curve = plotRows.length > SPLINE_MAX_POINTS ? 'linear' : 'natural'
  const showDots = plotRows.length <= MAX_POINTS_FOR_DOTS

  const afterColor = chartColorVar(resolveTagMeta(isolatedTag).chartIndex)

  const config: ChartConfig = {
    before: { label: 'Original', color: 'var(--muted-foreground)' },
    after: { label: 'Cleaned', color: afterColor },
  }

  const showBefore = view === 'original' || view === 'overlay'
  const showAfter = view === 'cleaned' || view === 'overlay'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Before &amp; After Preview
          </h3>
          <p className="text-xs text-muted-foreground">
            Visualizing the impact of the cleaning pipeline over time.
          </p>
        </div>
        <SegmentedToggle
          ariaLabel="Trend view"
          value={view}
          onChange={setView}
          options={VIEW_OPTIONS}
        />
      </div>

      {/* Isolate legend — pick which selected tag's before/after to show. */}
      {tags.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            Isolate:
          </span>
          {tags.map(tag => {
            const active = tag === isolatedTag
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onIsolate(tag)}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: chartColorVar(
                      resolveTagMeta(tag).chartIndex,
                    ),
                  }}
                />
                {tag}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-end gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Pan earlier in time"
          onClick={() => panBy(-0.5)}
          disabled={!zoomWindow || zoomWindow[0] <= 0}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Pan later in time"
          onClick={() => panBy(0.5)}
          disabled={!zoomWindow || zoomWindow[1] >= rows.length - 1}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <span className="mx-1 h-5 w-px bg-border" />

        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom in on time axis"
          onClick={zoomIn}
          disabled={visibleCount <= MIN_VISIBLE_POINTS}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom out on time axis"
          onClick={zoomOut}
          disabled={!isZoomed}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Reset zoom"
          onClick={() => setZoomWindow(null)}
          disabled={!isZoomed}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>

        <span className="ml-1 font-mono text-[11px] tabular-nums text-muted-foreground">
          {visibleCount} / {rows.length} pts
          {plotRows.length < visibleCount && ` · ${plotRows.length} drawn`}
        </span>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button
          variant={fitY ? 'default' : 'outline'}
          size="sm"
          className="h-7 px-2 text-[11px]"
          aria-pressed={fitY}
          onClick={() => setFitY(v => !v)}
        >
          Auto scale Y
        </Button>
      </div>

      <ChartContainer
        config={config}
        className="h-100 w-full transition-opacity"
        style={{ opacity: isStale ? 0.6 : 1 }}
      >
        <LineChart
          accessibilityLayer
          data={plotRows}
          margin={{ left: 12, right: 12 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={value => tickFormat(String(value))}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={value =>
              Number(value).toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })
            }
            domain={fitY || !fullYDomain ? undefined : fullYDomain}
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

          {showBefore && (
            <Line
              dataKey={(row: TagFillPreviewRow) => row.before}
              name="Original"
              type={curve}
              stroke="var(--muted-foreground)"
              strokeDasharray="6 3"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={!reducedMotion && !heavy}
            />
          )}

          {showAfter && (
            <Line
              dataKey={(row: TagFillPreviewRow) => row.after}
              name="Imputed"
              type={curve}
              stroke={afterColor}
              strokeWidth={2}
              fill={afterColor}
              fillOpacity={0.12}
              dot={showDots ? { r: 2, fill: afterColor } : false}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={!reducedMotion && !heavy}
            />
          )}
        </LineChart>
      </ChartContainer>
    </div>
  )
}
