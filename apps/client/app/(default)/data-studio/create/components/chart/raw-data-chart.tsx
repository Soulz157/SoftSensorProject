'use client'

import { useEffect, useMemo, useState } from 'react'
import { LineChart, CartesianGrid, XAxis, YAxis, Line } from 'recharts'
import {
  ChevronLeft,
  ChevronRight,
  LineChart as LineChartIcon,
  Loader2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  rangeConfig,
  resolveTagMeta,
  chartColorVar,
  type TimeRange,
} from '@/lib/mock-readings'
import type { SensorChartRow } from '@/hooks/use-sensor-readings'
import { RangeDisplay } from './range-display'
import { TagsSelector } from './tags-selector'
import { Button } from '@/components/ui/button'
import { SegmentedToggle } from '@/app/(default)/data-visualize/components/segmented-toggle'

interface Props {
  rows: SensorChartRow[]
  tags: string[]
  range: TimeRange
  hideTagSelector?: boolean
  /** Emphasized tag(s) from the sidebar — non-focused lines dim when set. */
  focusedTag?: string[]
  /** Master override: when true, every line renders at full opacity. */
  isViewAll?: boolean
  /**
   * Covers the plot with a spinner while the caller prepares a different
   * `rows`/`tags` set. Nothing here is async — this marks a render the caller
   * has deferred (see `CutOffSection`'s Before/After transition), so the chart
   * says it is working instead of freezing on the previous data.
   */
  loading?: boolean
}

const X_ZOOM_STEP = 1.6
const MIN_VISIBLE_POINTS = 8
const MAX_POINTS_FOR_DOTS = 120

/**
 * Per-line stroke opacity. "View all" forces full opacity, overriding focus;
 * otherwise a non-empty focus set dims everything but the focused tag(s).
 */
function getLineOpacity(
  tagId: string,
  focusedTag: string[] | undefined,
  isViewAll: boolean,
): number {
  if (isViewAll) return 1
  if (focusedTag && focusedTag.length > 0)
    return focusedTag.includes(tagId) ? 1 : 0.2
  return 1
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

function fmtTs(isoOrMs: string | number): string {
  return new Date(isoOrMs).toLocaleString('en-GB', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function durStr(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60),
    rm = m % 60
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function RawTrendChart({
  rows,
  tags,
  range,
  hideTagSelector = false,
  focusedTag,
  isViewAll = false,
  loading = false,
}: Props) {
  const reducedMotion = usePrefersReducedMotion()
  const { tickFormat } = rangeConfig(range)

  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const handleVisible = (next: string[] | null) =>
    setHidden(
      next === null ? new Set() : new Set(tags.filter(t => !next.includes(t))),
    )

  // Visibility has two owners: the caller's tag set (`tags`, already pruned
  // upstream) and this chart's own selector. "View all" only clears the
  // caller's half, so without this a tag hidden through the selector stayed
  // hidden after clicking it — a control that visibly did nothing.
  //
  // Adjusted during render rather than in an effect: this is state derived
  // from a prop CHANGE, so React re-runs this component before committing and
  // the user never sees the stale frame an effect would paint first.
  const [viewAllSeen, setViewAllSeen] = useState(isViewAll)
  if (viewAllSeen !== isViewAll) {
    setViewAllSeen(isViewAll)
    if (isViewAll) setHidden(new Set())
  }

  const [zoomWindow, setZoomWindow] = useState<[number, number] | null>(null)
  useEffect(() => {
    setZoomWindow(null)
  }, [rows])

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

  const visibleRows = useMemo(
    () => (zoomWindow ? rows.slice(zoomWindow[0], zoomWindow[1] + 1) : rows),
    [rows, zoomWindow],
  )

  const isZoomed =
    zoomWindow !== null &&
    (zoomWindow[0] > 0 || zoomWindow[1] < rows.length - 1)

  const [autoscaleY, setAutoscaleY] = useState(false)

  const isNum = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v)

  const cols = useMemo(() => {
    const out: Record<string, Float64Array> = {}
    for (const t of tags) {
      const a = new Float64Array(rows.length)
      for (let i = 0; i < rows.length; i++) {
        const v = rows[i]![t]
        a[i] = typeof v === 'number' && Number.isFinite(v) ? v : NaN
      }
      out[t] = a
    }
    return out
  }, [rows, tags])

  const lockedYDomain = useMemo<[number, number] | null>(() => {
    const shown = tags.filter(t => !hidden.has(t))
    if (shown.length === 0) return null
    let lo = Infinity
    let hi = -Infinity
    for (const t of shown) {
      const a = cols[t]
      if (!a) continue
      for (let i = 0; i < a.length; i++) {
        const v = a[i]!
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
    if (lo > hi) return null
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.05
    return [lo - pad, hi + pad]
  }, [cols, tags, hidden])

  const colorByTag = useMemo(
    () =>
      Object.fromEntries(
        tags.map(t => [t, chartColorVar(resolveTagMeta(t).chartIndex)]),
      ) as Record<string, string>,
    [tags],
  )

  const config = useMemo<ChartConfig>(() => {
    return Object.fromEntries(
      tags.map(piTag => {
        const meta = resolveTagMeta(piTag)
        return [piTag, { label: meta.label, color: colorByTag[piTag] }]
      }),
    )
  }, [tags, colorByTag])

  const w0 = zoomWindow?.[0] ?? 0
  const w1 = zoomWindow?.[1] ?? rows.length - 1
  const rangeStart = rows.length ? fmtTs(rows[w0]!.timestamp as string) : null
  const rangeEnd = rows.length ? fmtTs(rows[w1]!.timestamp as string) : null
  const rangeDur =
    rows.length > 1
      ? durStr(
          new Date(rows[w1]!.timestamp as string).getTime() -
            new Date(rows[w0]!.timestamp as string).getTime(),
        )
      : null

  const visibleTags = tags.filter(t => !hidden.has(t))

  if (tags.length === 0) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <LineChartIcon className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Select one or more PI tags to plot
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ── Tag selector (visible-series control) ── */}
      {!hideTagSelector && (
        <TagsSelector
          available={tags}
          active={visibleTags}
          onChange={handleVisible}
        />
      )}

      <RangeDisplay
        startTs={rangeStart}
        endTs={rangeEnd}
        duration={rangeDur}
        isZoomed={isZoomed}
        onReset={() => setZoomWindow(null)}
      />

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
          disabled={visibleRows.length <= MIN_VISIBLE_POINTS}
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

        <span className="ml-3 font-mono text-[11px] tabular-nums text-muted-foreground ">
          {visibleRows.length} / {rows.length} pts
        </span>
        <SegmentedToggle
          ariaLabel="Y axis scale"
          value={autoscaleY ? 'auto' : 'full'}
          onChange={v => setAutoscaleY(v === 'auto')}
          options={[
            { value: 'full', label: 'Full Scale Y' },
            { value: 'auto', label: 'Autoscale Y' },
          ]}
        />
      </div>

      {/* ── Main chart ──
          The chart stays MOUNTED under the overlay rather than being swapped
          for a spinner: unmounting would discard `zoomWindow`, `hidden` and
          `autoscaleY`, so every Before/After flip would silently reset the
          user's zoom. */}
      <div className="relative">
        {loading && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/60"
            role="status"
            aria-label="Loading chart data"
          >
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <ChartContainer config={config} className="h-100 w-full">
          <LineChart
            accessibilityLayer
            data={visibleRows}
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
              width={56}
              tickMargin={8}
              domain={autoscaleY || !lockedYDomain ? undefined : lockedYDomain}
              tickFormatter={v =>
                isNum(v)
                  ? v.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : ''
              }
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
            {visibleTags.map(piTag => {
              const opacity = getLineOpacity(piTag, focusedTag, isViewAll)
              const isFocused = !isViewAll && !!focusedTag?.includes(piTag)
              const heavy = visibleRows.length > 200

              return (
                <Line
                  key={piTag}
                  dataKey={(row: SensorChartRow) => row[piTag]}
                  name={piTag}
                  type={visibleRows.length > 200 ? 'linear' : 'natural'}
                  stroke={colorByTag[piTag]}
                  strokeOpacity={opacity}
                  strokeWidth={isFocused ? 3 : 2}
                  fill={colorByTag[piTag]}
                  fillOpacity={opacity < 1 ? 0 : 0.12}
                  dot={
                    visibleRows.length > MAX_POINTS_FOR_DOTS
                      ? false
                      : { r: 3, fill: colorByTag[piTag] }
                  }
                  activeDot={{ r: 6 }}
                  connectNulls
                  isAnimationActive={!reducedMotion && !heavy}
                />
              )
            })}
            {/* {rows.length > 2 && (
            <Brush
              dataKey="timestamp"
              height={28}
              travellerWidth={10}
              stroke="var(--border)"
              fill="var(--muted)"
              startIndex={zoomWindow?.[0]}
              endIndex={zoomWindow?.[1]}
              tickFormatter={value => {
                try {
                  return new Date(String(value)).toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                } catch {
                  return ''
                }
              }}
              onChange={(r: { startIndex?: number; endIndex?: number }) => {
                if (
                  typeof r.startIndex === 'number' &&
                  typeof r.endIndex === 'number'
                ) {
                  setZoomWindow([r.startIndex, r.endIndex])
                }
              }}
            />
          )} */}
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  )
}
