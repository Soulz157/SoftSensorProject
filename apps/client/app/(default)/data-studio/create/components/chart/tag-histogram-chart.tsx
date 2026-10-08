'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { BarChart3, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'
import type { DraftHistogramResult } from '@/services/dataset-draft'

/**
 * DS-LAKE-005B-D-T01. Consumes the SERVER histogram response — mean/median/
 * KDE curve are computed by `histogram_service.py`, not this component. The
 * `kde` points arrive already rescaled onto the count axis (density * n *
 * binWidth); this component does no statistics of its own anymore, only
 * axis/zoom/pan presentation. `Dataset` is deliberately NOT accepted here
 * (DS-LAKE-005B-D-V05 type gate) — a caller cannot hand this component a
 * bare full-frame dataset even by accident.
 *
 * `status` distinguishes empty states the old dataset-driven version
 * couldn't tell apart:
 *   - 'no-tags': `tags` is empty (e.g. `useCompareTags` hasn't seeded a
 *     selection yet on first mount) — genuinely nothing to query. Caught
 *     as a real bug in review: without this case, an empty `tags` on first
 *     render fell through to 'ready' with no data, rendering "Not enough
 *     values to build a histogram for " (blank) instead of the true reason.
 *   - 'pending': no draft artifact exists yet to query (e.g. Step 3.1
 *     before the first "Save Cleaned Tags" sync) — NOT the same as "queried
 *     and found insufficient data". Rendering the insufficient-data message
 *     here would misreport a wait as a real finding.
 *   - 'loading': a request is in flight for the current artifact/tags.
 *   - 'ready': `data` reflects the current artifact/tags (or the request
 *     failed — `data` stays null and the insufficient-data message shows;
 *     callers surface fetch errors separately, this component does not).
 */
interface Props {
  data: DraftHistogramResult | null
  tags: string[]
  status: 'no-tags' | 'pending' | 'loading' | 'ready' | 'unavailable'
  /**
   * DS-LAKE-026. Optional per-tag colour/dash override for the compare
   * modal's two-sided (train vs. validation) tabs — the wizard's own
   * callers pass nothing and get today's `chartColorVar` colouring
   * unchanged. `dashed` needs its own field rather than piggybacking on
   * `color`: the KDE stroke otherwise carries no `strokeDasharray` at all.
   */
  seriesStyle?: (tag: string) => { color: string; dashed?: boolean }
}

const W = 750
const H = 460
const PAD_LEFT = 44
const PAD_RIGHT = 12
const PAD_TOP = 32
const PAD_BOTTOM = 40
const PLOT_W = W - PAD_LEFT - PAD_RIGHT
const PLOT_H = H - PAD_TOP - PAD_BOTTOM
const MAX_TAGS_FOR_INLINE_LABELS = 5
const ZOOM_MIN = 1
const ZOOM_MAX = 8
const ZOOM_STEP = 1.4

const TARGET_Y_TICKS = 5
const TARGET_X_TICKS = 9
const MIN_X_TICK_PX = 64
const Y_ZOOM_MIN = 1
const Y_ZOOM_MAX = 50
const Y_ZOOM_STEP = 1.6

function niceStep(range: number, target = TARGET_Y_TICKS): number {
  if (!Number.isFinite(range) || range <= 0) return 1
  const rough = range / target
  const mag = 10 ** Math.floor(Math.log10(rough))
  const norm = rough / mag
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return mult * mag
}

function fmtCount(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${fmt(n / 1_000_000)}M`
  if (abs >= 1_000) return `${fmt(n / 1_000)}k`
  return fmt(n)
}

function fmtValue(n: number, step: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${fmt(n / 1_000_000)}M`
  if (abs >= 10_000) return `${fmt(n / 1_000)}k`
  const decimals = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)) + 1)
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

interface TagLayer {
  tag: string
  color: string
  /** DS-LAKE-026. `seriesStyle`'s dash flag, carried onto the KDE stroke
   * only — the fill/halo stay solid regardless, same convention the compare
   * modal's Line tab already uses for a validation series. */
  dashed: boolean
  mean: number
  median: number
  kdeCounts: { x: number; y: number }[]
}

function computeLayerOpacities(layerCount: number) {
  const fillOpacity = layerCount <= 1 ? 0.22 : Math.max(0.06, 0.32 / layerCount)
  const haloOpacity = layerCount <= 1 ? 0.16 : Math.max(0.04, 0.22 / layerCount)
  const strokeOpacity =
    layerCount <= 5 ? 1 : Math.max(0.75, 1 - (layerCount - 5) * 0.05)
  return { fillOpacity, haloOpacity, strokeOpacity }
}

export function TagHistogramChart({ data, tags, status, seriesStyle }: Props) {
  const [zoom, setZoom] = useState(1)
  const [yZoom, setYZoom] = useState(1)
  const [center, setCenter] = useState(0.5)

  const zoomIn = () => setZoom(z => Math.min(ZOOM_MAX, z * ZOOM_STEP))
  const zoomOut = () => setZoom(z => Math.max(ZOOM_MIN, z / ZOOM_STEP))
  const yZoomIn = () => setYZoom(z => Math.min(Y_ZOOM_MAX, z * Y_ZOOM_STEP))
  const yZoomOut = () => setYZoom(z => Math.max(Y_ZOOM_MIN, z / Y_ZOOM_STEP))
  const resetView = () => {
    setZoom(1)
    setYZoom(1)
    setCenter(0.5)
  }

  const clipId = useId()
  const dragRef = useRef<{ x: number } | null>(null)

  const insufficientTags = data?.insufficient_tags ?? []

  // Unpadded domain, straight from the server response. Padding is applied
  // client-side below — same 0.5x-range formula the server used internally
  // to sample the KDE curve, so `paddedDomain` here reproduces the exact
  // bounds `data.tags[].kde`'s x-values already span.
  const domain = useMemo(() => {
    if (data?.domain_min == null || data?.domain_max == null) return null
    return { min: data.domain_min, max: data.domain_max }
  }, [data])

  const paddedDomain = useMemo(() => {
    if (!domain) return null
    const range = domain.max - domain.min
    const pad = (range || Math.abs(domain.max) || 1) * 0.5
    return { min: domain.min - pad, max: domain.max + pad }
  }, [domain])

  const layers = useMemo<TagLayer[]>(() => {
    if (!data || !domain) return []
    // Preserve `tags` (the caller's selection order) rather than
    // `data.tags`' order — both agree in practice (the server iterates the
    // request's own `tags` array), but keying off the prop keeps color
    // assignment stable even if that ever changes server-side.
    const byTag = new Map(data.tags.map(t => [t.tag, t]))
    return tags.flatMap(tag => {
      const t = byTag.get(tag)
      if (!t) return []
      const style = seriesStyle?.(tag)
      return [
        {
          tag,
          color: style?.color ?? chartColorVar(resolveTagMeta(tag).chartIndex),
          dashed: style?.dashed ?? false,
          mean: t.mean,
          median: t.median,
          kdeCounts: t.kde,
        },
      ]
    })
  }, [data, domain, tags, seriesStyle])

  if (status === 'no-tags') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Select a tag to compare above.
        </p>
      </div>
    )
  }

  if (status === 'pending') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Save cleaned tags to build a histogram.
        </p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="flex aspect-750/460 flex-col items-center justify-center gap-2 text-center">
        <BarChart3 className="h-8 w-8 animate-pulse text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Loading histogram…</p>
      </div>
    )
  }

  if (status === 'unavailable') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 px-6 text-center">
        <BarChart3 className="h-8 w-8 animate-pulse text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          This dataset&apos;s raw artifact is no longer stored, so this chart
          has nothing to read. Apply a cleaning rule to create a new artifact
          from the loaded rows.
        </p>
      </div>
    )
  }

  if (!domain || !paddedDomain || layers.length === 0) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Not enough values to build a histogram for{' '}
          <span className="font-mono">{tags.join(', ')}</span>
        </p>
      </div>
    )
  }

  const fullRange = paddedDomain.max - paddedDomain.min || 1
  const visRange = fullRange / zoom
  const half = visRange / 2
  let centerVal = paddedDomain.min + center * fullRange
  if (centerVal - half < paddedDomain.min) centerVal = paddedDomain.min + half
  if (centerVal + half > paddedDomain.max) centerVal = paddedDomain.max - half
  const xMin = centerVal - half
  const xMax = centerVal + half

  const onPanStart = (e: React.PointerEvent<SVGRectElement>) => {
    if (zoom <= ZOOM_MIN) return
    dragRef.current = { x: e.clientX }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPanMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.x
    dragRef.current.x = e.clientX
    const domainDelta = -(dx / PLOT_W) * visRange
    setCenter(c => clamp01(c + domainDelta / fullRange))
  }
  const onPanEnd = (e: React.PointerEvent<SVGRectElement>) => {
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
  }

  const maxKdeCount = Math.max(
    0,
    ...layers.flatMap(l => l.kdeCounts.map(p => p.y)),
  )
  const yMaxFull = Math.max(1, (maxKdeCount || 1) * 1.1)
  const yMaxView = yMaxFull / yZoom
  const xScale = (v: number) =>
    PAD_LEFT + ((v - xMin) / (xMax - xMin || 1)) * PLOT_W
  const yScale = (c: number) =>
    PAD_TOP + PLOT_H - (c / (yMaxView || 1)) * PLOT_H

  const yStep = niceStep(yMaxView)
  const yTicks = Array.from(
    { length: Math.floor(yMaxView / yStep) + 2 },
    (_, i) => i * yStep,
  )

  const xTickTarget = Math.max(
    2,
    Math.min(TARGET_X_TICKS, Math.floor(PLOT_W / MIN_X_TICK_PX)),
  )
  const xStep = niceStep(xMax - xMin, xTickTarget)
  const xFirst = Math.ceil(xMin / xStep) * xStep
  const xTickCount = Math.max(
    0,
    Math.min(40, Math.floor((xMax - xFirst) / xStep) + 1),
  )
  const xTicks = Array.from(
    { length: xTickCount },
    (_, i) => xFirst + i * xStep,
  )

  const kdePath = (layer: TagLayer) =>
    layer.kdeCounts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x)},${yScale(p.y)}`)
      .join(' ')

  const kdeAreaPath = (layer: TagLayer) => {
    if (layer.kdeCounts.length === 0) return ''
    const baseY = yScale(0)
    const first = layer.kdeCounts[0] ?? { x: xMin, y: 0 }
    const last = layer.kdeCounts[layer.kdeCounts.length - 1] ?? {
      x: xMax,
      y: 0,
    }
    return `${kdePath(layer)} L ${xScale(last?.x)},${baseY} L ${xScale(first?.x)},${baseY} Z`
  }

  const layerCount = layers.length
  const { fillOpacity, haloOpacity, strokeOpacity } =
    computeLayerOpacities(layerCount)
  const showInlineLabels = layerCount <= MAX_TAGS_FOR_INLINE_LABELS
  const labelRowHeight = layerCount <= 1 ? 18 : layerCount === 2 ? 15 : 12

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 font-mono text-[13px] tracking-wide uppercase">
        {layers.map(layer => (
          <span
            key={layer.tag}
            className="flex items-center gap-1.5 font-medium text-foreground"
          >
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: layer.color }}
            />
            {layer.tag}
          </span>
        ))}
        {insufficientTags.length > 0 && (
          <span className="text-muted-foreground normal-case">
            (Not enough values for {insufficientTags.join(', ')})
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 font-mono text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <svg width="18" height="4">
            <line
              x1="0"
              y1="2"
              x2="18"
              y2="2"
              stroke="var(--foreground)"
              strokeDasharray="6 3"
              strokeWidth={1.5}
            />
          </svg>
          Mean
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="4">
            <line
              x1="0"
              y1="2"
              x2="18"
              y2="2"
              stroke="var(--foreground)"
              strokeDasharray="2 3"
              strokeWidth={1.5}
              opacity={0.75}
            />
          </svg>
          Median
        </span>
        {!showInlineLabels && (
          <span className="normal-case opacity-70">
            ({layerCount} tags shown — see legend above for values)
          </span>
        )}
      </div>

      <div className="relative">
        <div className="p-2 sm:p-1">
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md border border-border bg-background/90 p-1 ">
            <span className="px-0.5 font-mono text-[10px] text-muted-foreground">
              X
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Zoom in on value axis"
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Zoom out on value axis"
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>

            <span className="mx-0.5 h-5 w-px bg-border" />

            <span className="px-0.5 font-mono text-[10px] text-muted-foreground">
              Y
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Zoom in on count axis"
              onClick={yZoomIn}
              disabled={yZoom >= Y_ZOOM_MAX}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Zoom out on count axis"
              onClick={yZoomOut}
              disabled={yZoom <= Y_ZOOM_MIN}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>

            <span className="mx-0.5 h-5 w-px bg-border" />

            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Reset view"
              onClick={resetView}
              disabled={zoom <= ZOOM_MIN && yZoom <= Y_ZOOM_MIN}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full max-h-300"
          role="img"
          aria-label={`KDE distribution of ${layers.map(l => l.tag).join(', ')}`}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD_LEFT} y={PAD_TOP} width={PLOT_W} height={PLOT_H} />
            </clipPath>
          </defs>
          {yTicks.map(t => (
            <g key={t}>
              <line
                x1={PAD_LEFT}
                x2={W - PAD_RIGHT}
                y1={yScale(t)}
                y2={yScale(t)}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={PAD_LEFT - 8}
                y={yScale(t)}
                dy="0.32em"
                textAnchor="end"
                fill="var(--muted-foreground)"
                className="font-mono text-[10px]"
              >
                {fmtCount(t)}
              </text>
            </g>
          ))}

          <g clipPath={`url(#${clipId})`}>
            {layers.map(layer => (
              <path
                key={`${layer.tag}-kde-area`}
                d={kdeAreaPath(layer)}
                fill={layer.color}
                fillOpacity={fillOpacity}
                stroke="none"
              />
            ))}

            {layers.map(layer => (
              <path
                key={`${layer.tag}-kde`}
                d={kdePath(layer)}
                fill="none"
                stroke={layer.color}
                strokeWidth={2.5}
                strokeOpacity={strokeOpacity}
                strokeDasharray={layer.dashed ? '5 3' : undefined}
              />
            ))}

            {layers.map((layer, i) => {
              const meanX = xScale(layer.mean)
              const medianX = xScale(layer.median)
              return (
                <g key={`${layer.tag}-refs`}>
                  {/* Mean */}
                  <line
                    x1={meanX}
                    x2={meanX}
                    y1={PAD_TOP}
                    y2={PAD_TOP + PLOT_H}
                    stroke={layer.color}
                    strokeWidth={5}
                    opacity={haloOpacity}
                  />
                  <line
                    x1={meanX}
                    x2={meanX}
                    y1={PAD_TOP}
                    y2={PAD_TOP + PLOT_H}
                    stroke="var(--foreground)"
                    strokeDasharray="6 3"
                    strokeWidth={1.5}
                  />

                  {/* Median */}
                  <line
                    x1={medianX}
                    x2={medianX}
                    y1={PAD_TOP}
                    y2={PAD_TOP + PLOT_H}
                    stroke={layer.color}
                    strokeWidth={5}
                    opacity={haloOpacity}
                  />
                  <line
                    x1={medianX}
                    x2={medianX}
                    y1={PAD_TOP}
                    y2={PAD_TOP + PLOT_H}
                    stroke="var(--foreground)"
                    strokeDasharray="2 3"
                    strokeWidth={1.25}
                    opacity={0.75}
                  />

                  {showInlineLabels && (
                    <>
                      <text
                        x={meanX + 4}
                        y={PAD_TOP + 12 + i * labelRowHeight}
                        textAnchor="start"
                        fill={layer.color}
                        className="font-mono text-[10px] font-semibold"
                      >
                        Mean
                      </text>
                      <text
                        x={medianX + 4}
                        y={
                          PAD_TOP +
                          12 +
                          layerCount * labelRowHeight +
                          i * labelRowHeight
                        }
                        textAnchor="start"
                        fill={layer.color}
                        className="font-mono text-[10px] font-semibold"
                      >
                        Median
                      </text>
                    </>
                  )}
                </g>
              )
            })}
          </g>

          {xTicks.map(v => {
            const x = xScale(v)
            // Clamp the anchor at the edges so the first and last labels don't
            // hang outside the viewBox and get clipped.
            const anchor =
              x < PAD_LEFT + 20
                ? ('start' as const)
                : x > W - PAD_RIGHT - 20
                  ? ('end' as const)
                  : ('middle' as const)
            return (
              <g key={v}>
                <line
                  x1={x}
                  x2={x}
                  y1={PAD_TOP}
                  y2={PAD_TOP + PLOT_H}
                  stroke="var(--border)"
                  strokeWidth={1}
                  opacity={0.45}
                />
                <line
                  x1={x}
                  x2={x}
                  y1={PAD_TOP + PLOT_H}
                  y2={PAD_TOP + PLOT_H + 5}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={x}
                  y={H - PAD_BOTTOM + 18}
                  textAnchor={anchor}
                  fill="var(--muted-foreground)"
                  className="font-mono text-[10px]"
                >
                  {fmtValue(v, xStep)}
                </text>
              </g>
            )
          })}
          {/* Transparent drag surface for panning (only meaningful when zoomed). */}
          <rect
            x={PAD_LEFT}
            y={PAD_TOP}
            width={PLOT_W}
            height={PLOT_H}
            fill="transparent"
            style={{
              cursor: zoom > ZOOM_MIN ? 'grab' : 'default',
              touchAction: 'none',
            }}
            onPointerDown={onPanStart}
            onPointerMove={onPanMove}
            onPointerUp={onPanEnd}
            onPointerCancel={onPanEnd}
          />
        </svg>
      </div>
    </div>
  )
}
