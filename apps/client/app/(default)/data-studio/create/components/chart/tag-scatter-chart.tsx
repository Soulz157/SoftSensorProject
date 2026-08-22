'use client'

import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart as RechartsScatterChart,
  XAxis,
  YAxis,
  ZAxis,
  Label,
} from 'recharts'
import {
  ScatterChart as ScatterIcon,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { regressionSegment } from '@/lib/preprocessing'
import { tagMeta } from '@/lib/mock-readings'
import type { DraftScatterResult } from '@/services/dataset-draft'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

type Bounds = { x: [number, number]; y: [number, number] }
/**
 * Zoom step. 0.7 keeps ~70% of the current span per click — small enough that
 * three clicks land somewhere useful rather than overshooting, large enough
 * that one click is visibly different.
 */
const ZOOM_FACTOR = 0.7

/** Scales a span around its own midpoint. Zooming about the CENTRE rather
 * than the origin is what makes repeated clicks feel like they hold position;
 * scaling about zero would drift the view sideways on every step. */
function scaleAbout(
  [lo, hi]: [number, number],
  factor: number,
): [number, number] {
  const mid = (lo + hi) / 2
  const half = ((hi - lo) / 2) * factor
  return [mid - half, mid + half]
}
/**
 * DS-LAKE-005B-D-T04. Consumes the SERVER scatter response — the decimated
 * point cloud and regression coefficients are computed by
 * `scatter_service.py`, not this component. `Dataset` is deliberately NOT
 * accepted here (same DS-LAKE-005B-D-V05 type gate `TagHistogramChart`/
 * `TagBoxplotChart` apply).
 *
 * SIMPLIFICATION vs the client-only `ScatterRegressionChart` this replaces
 * in Step 3.1: X/Y tag selection is NOT owned by this component (no
 * internal `<Select>`), matching `TagHistogramChart`/`TagBoxplotChart`'s
 * own pattern — tag selection lives in the PARENT via the existing
 * `compareTags`/`focusedTag` state (`useCompareTags`), not a second picker.
 * The old component's correlation-based X auto-default (`pearsonMatrix`)
 * is dropped for the same reason: it needs the full client frame, which
 * this component's whole point is to not require. Not a silent narrowing —
 * recorded here and in this task's own `result`.
 *
 * `status` mirrors `TagHistogramChart`/`TagBoxplotChart`'s exact union.
 */
interface Props {
  data: DraftScatterResult | null
  xTag: string
  yTag: string
  status: 'no-tags' | 'pending' | 'loading' | 'ready' | 'unavailable'
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function TagScatterChart({ data, xTag, yTag, status }: Props) {
  const xMeta = tagMeta(xTag)
  const yMeta = tagMeta(yTag)

  const config: ChartConfig = {
    x: { label: xMeta?.label ?? xTag, color: 'var(--chart-2)' },
    y: { label: yMeta?.label ?? yTag, color: 'var(--chart-2)' },
  }

  const [zoom, setZoom] = useState<Bounds | null>(null)

  // The full extent of the plotted cloud, used as the zoom baseline. Derived
  // from `points` (what is actually drawn), not from the artifact's own
  // min/max — a zoom control that could scroll past every visible point would
  // read as broken.
  const extent = useMemo<Bounds | null>(() => {
    if (!data || data.points.length === 0) return null
    let xLo = Infinity
    let xHi = -Infinity
    let yLo = Infinity
    let yHi = -Infinity
    for (const p of data.points) {
      if (p.x < xLo) xLo = p.x
      if (p.x > xHi) xHi = p.x
      if (p.y < yLo) yLo = p.y
      if (p.y > yHi) yHi = p.y
    }
    return { x: [xLo, xHi], y: [yLo, yHi] }
  }, [data])

  const bounds = zoom ?? extent

  const zoomBy = (factor: number) => {
    if (!bounds) return
    setZoom({
      x: scaleAbout(bounds.x, factor),
      y: scaleAbout(bounds.y, factor),
    })
  }

  // Zooming out past the data's own extent is pointless — there is nothing
  // out there to see. Clamping at `extent` also means "zoomed out fully" and
  // "not zoomed" are the same state, so Reset never becomes a no-op the user
  // has to guess at.
  const zoomOut = () => {
    if (!bounds || !extent) return
    const next = {
      x: scaleAbout(bounds.x, 1 / ZOOM_FACTOR),
      y: scaleAbout(bounds.y, 1 / ZOOM_FACTOR),
    }
    const spansExtent =
      next.x[0] <= extent.x[0] &&
      next.x[1] >= extent.x[1] &&
      next.y[0] <= extent.y[0] &&
      next.y[1] >= extent.y[1]
    setZoom(spansExtent ? null : next)
  }

  if (status === 'no-tags') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <ScatterIcon className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Select an X and a Y tag above.
        </p>
      </div>
    )
  }

  if (status === 'pending') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <ScatterIcon className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Save cleaned tags to build a scatter plot.
        </p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <ScatterIcon className="h-8 w-8 animate-pulse text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Loading scatter plot…</p>
      </div>
    )
  }

  if (status === 'unavailable') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 px-6 text-center">
        <ScatterIcon className="h-8 w-8 animate-pulse text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          This dataset&apos;s raw artifact is no longer stored, so this chart
          has nothing to read. Apply a cleaning rule to create a new artifact
          from the loaded rows.
        </p>
      </div>
    )
  }

  if (!data || data.n < 2) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <ScatterIcon className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Not enough paired values for{' '}
          <span className="font-mono">
            {xTag}, {yTag}
          </span>
        </p>
      </div>
    )
  }

  const segment =
    data.points.length >= 2
      ? regressionSegment(data.points, data.slope, data.intercept)
      : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
          <span>
            X <span className="text-foreground">{xMeta?.label ?? xTag}</span>
          </span>
          <span>
            Y <span className="text-foreground">{yMeta?.label ?? yTag}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 cursor-pointer"
              onClick={() => zoomBy(ZOOM_FACTOR)}
              aria-label="Zoom in"
              disabled={!bounds}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 cursor-pointer"
              onClick={zoomOut}
              aria-label="Zoom out"
              disabled={!zoom}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 cursor-pointer gap-1.5 px-2 text-xs"
              onClick={() => setZoom(null)}
              disabled={!zoom}
            >
              <Undo2 className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>

          <div className="rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-foreground">
            y = {fmt(data.slope)}x + {fmt(data.intercept)} · R² ={' '}
            {data.r2.toFixed(3)}
            {data.downsampled && (
              <span className="ml-1.5 text-muted-foreground">
                ({data.points.length.toLocaleString()} of{' '}
                {data.n.toLocaleString()} shown; fit uses all{' '}
                {data.n.toLocaleString()})
              </span>
            )}
          </div>
        </div>
      </div>

      {zoom && (
        // States BOTH limits, because either alone would mislead: the fit is
        // not recomputed for the visible window, and no extra points arrive
        // at depth.
        <p className="text-[11px] text-muted-foreground">
          Zoomed view — the fit above still uses all {data.n.toLocaleString()}{' '}
          pairs, and no additional points load at this zoom level.
        </p>
      )}

      <ChartContainer config={config} className="h-80 w-full">
        <RechartsScatterChart
          margin={{ top: 8, right: 16, bottom: 24, left: 8 }}
        >
          <CartesianGrid />
          <XAxis
            type="number"
            dataKey="x"
            name={xMeta?.label ?? xTag}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={fmt}
            domain={['auto', 'auto']}
            height={52}
          >
            {/* The header row above states which tag is on which axis, but it
                is 80px away from the plot and disappears the moment the chart
                is screenshotted or exported. An axis title travels with the
                figure. */}
            <Label
              value={
                xMeta?.unit
                  ? `${xMeta.label ?? xTag} (${xMeta.unit})`
                  : (xMeta?.label ?? xTag)
              }
              position="insideBottom"
              offset={-4}
              style={{
                fill: 'var(--muted-foreground)',
                fontSize: 11,
                textAnchor: 'middle',
              }}
            />
          </XAxis>
          <YAxis
            type="number"
            dataKey="y"
            name={yMeta?.label ?? yTag}
            tickLine={false}
            axisLine={false}
            width={68}
            tickFormatter={fmt}
            domain={['auto', 'auto']}
          >
            <Label
              value={
                yMeta?.unit
                  ? `${yMeta.label ?? yTag} (${yMeta.unit})`
                  : (yMeta?.label ?? yTag)
              }
              angle={-90}
              position="insideLeft"
              style={{
                fill: 'var(--muted-foreground)',
                fontSize: 11,
                textAnchor: 'middle',
              }}
            />
          </YAxis>
          <ZAxis range={[50, 50]} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Scatter
            data={data.points}
            fill="var(--chart-2)"
            isAnimationActive={false}
          />
          {segment && (
            <ReferenceLine
              ifOverflow="extendDomain"
              segment={segment}
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}
        </RechartsScatterChart>
      </ChartContainer>
    </div>
  )
}
