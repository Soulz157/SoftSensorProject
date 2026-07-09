'use client'

import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import { kdeEstimate, densityToCount } from '@/lib/data-quality'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'

interface Props {
  /** Good-only raw values for the tag, before imputation. */
  before: number[]
  /** All post-fill values for the tag. */
  after: number[]
  tag: string
}

const W = 900
const H = 320
const PAD_LEFT = 44
const PAD_RIGHT = 12
const PAD_TOP = 32
const PAD_BOTTOM = 32
const PLOT_W = W - PAD_LEFT - PAD_RIGHT
const PLOT_H = H - PAD_TOP - PAD_BOTTOM
const BIN_COUNT = 12
const KDE_SAMPLES = 100
const FILL_OPACITY = 0.18
const HALO_OPACITY = 0.12
const STROKE_OPACITY = 1

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function meanOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const mid = Math.floor(n / 2)
  return n % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0)
}

interface Layer {
  name: 'Original' | 'Imputed'
  color: string
  mean: number
  median: number
  kdeCounts: { x: number; y: number }[]
}

/**
 * Before/after distribution overlay for a single tag in Step 5.2 — forked
 * from `chart/tag-histogram-chart.tsx`'s KDE/SVG machinery, hardcoded to
 * exactly 2 named layers (Original vs Imputed) instead of iterating N tags.
 */
export function ImputationComparisonHistogram({ before, after, tag }: Props) {
  const afterColor = chartColorVar(resolveTagMeta(tag).chartIndex)

  const domain = useMemo(() => {
    const qualifying = [
      ...(before.length >= 2 ? before : []),
      ...(after.length >= 2 ? after : []),
    ]
    if (qualifying.length < 2) return null
    return { min: Math.min(...qualifying), max: Math.max(...qualifying) }
  }, [before, after])

  const binWidth = domain ? (domain.max - domain.min) / BIN_COUNT : 0

  const layers = useMemo<Layer[]>(() => {
    if (!domain || binWidth <= 0) return []
    const out: Layer[] = []
    const build = (
      name: Layer['name'],
      values: number[],
      color: string,
    ): Layer | null => {
      if (values.length < 2) return null
      const kde = kdeEstimate(values, domain, KDE_SAMPLES)
      const kdeCounts = kde.map(p => ({
        x: p.x,
        y: densityToCount(p.y, values.length, binWidth),
      }))
      return {
        name,
        color,
        mean: meanOf(values),
        median: medianOf(values),
        kdeCounts,
      }
    }
    const originalLayer = build('Original', before, 'var(--muted-foreground)')
    const imputedLayer = build('Imputed', after, afterColor)
    if (originalLayer) out.push(originalLayer)
    if (imputedLayer) out.push(imputedLayer)
    return out
  }, [domain, binWidth, before, after, afterColor])

  if (!domain || layers.length === 0) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Not enough values to build a distribution for{' '}
          <span className="font-mono">{tag}</span>
        </p>
      </div>
    )
  }

  const xMin = domain.min
  const xMax = domain.max
  const maxKdeCount = Math.max(
    0,
    ...layers.flatMap(l => l.kdeCounts.map(p => p.y)),
  )
  const yMax = (maxKdeCount || 1) * 1.1

  const xScale = (v: number) =>
    PAD_LEFT + ((v - xMin) / (xMax - xMin || 1)) * PLOT_W
  const yScale = (c: number) => PAD_TOP + PLOT_H - (c / (yMax || 1)) * PLOT_H
  const yTicks = [0, Math.round(yMax / 2), Math.round(yMax)]

  const kdePath = (layer: Layer) =>
    layer.kdeCounts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x)},${yScale(p.y)}`)
      .join(' ')

  const kdeAreaPath = (layer: Layer) => {
    if (layer.kdeCounts.length === 0) return ''
    const baseY = yScale(0)
    const first = layer.kdeCounts[0] ?? { x: xMin, y: 0 }
    const last = layer.kdeCounts[layer.kdeCounts.length - 1] ?? {
      x: xMax,
      y: 0,
    }
    return `${kdePath(layer)} L ${xScale(last.x)},${baseY} L ${xScale(first.x)},${baseY} Z`
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Distribution Impact
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Check if filling skewed the data shape.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] tracking-wide uppercase">
        {layers.map(layer => (
          <span
            key={layer.name}
            className="flex items-center gap-1.5 font-medium text-foreground"
          >
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: layer.color }}
            />
            {layer.name}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-72 w-full"
        role="img"
        aria-label={`Before/after distribution of ${tag}`}
      >
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
              {t}
            </text>
          </g>
        ))}

        {layers.map(layer => (
          <path
            key={`${layer.name}-area`}
            d={kdeAreaPath(layer)}
            fill={layer.color}
            fillOpacity={FILL_OPACITY}
            stroke="none"
          />
        ))}

        {layers.map(layer => (
          <path
            key={`${layer.name}-kde`}
            d={kdePath(layer)}
            fill="none"
            stroke={layer.color}
            strokeWidth={2.5}
            strokeOpacity={STROKE_OPACITY}
          />
        ))}

        {layers.map((layer, i) => {
          const meanX = xScale(layer.mean)
          const medianX = xScale(layer.median)
          return (
            <g key={`${layer.name}-refs`}>
              <line
                x1={meanX}
                x2={meanX}
                y1={PAD_TOP}
                y2={PAD_TOP + PLOT_H}
                stroke={layer.color}
                strokeWidth={5}
                opacity={HALO_OPACITY}
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
              <line
                x1={medianX}
                x2={medianX}
                y1={PAD_TOP}
                y2={PAD_TOP + PLOT_H}
                stroke={layer.color}
                strokeWidth={5}
                opacity={HALO_OPACITY}
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
              <text
                x={meanX + 4}
                y={PAD_TOP + 12 + i * 15}
                textAnchor="start"
                fill={layer.color}
                className="font-mono text-[10px] font-semibold"
              >
                Mean
              </text>
              <text
                x={medianX + 4}
                y={PAD_TOP + 12 + layers.length * 15 + i * 15}
                textAnchor="start"
                fill={layer.color}
                className="font-mono text-[10px] font-semibold"
              >
                Median
              </text>
            </g>
          )
        })}

        <text
          x={PAD_LEFT}
          y={H - PAD_BOTTOM + 16}
          textAnchor="start"
          fill="var(--muted-foreground)"
          className="font-mono text-[10px]"
        >
          {fmt(xMin)}
        </text>
        <text
          x={W - PAD_RIGHT}
          y={H - PAD_BOTTOM + 16}
          textAnchor="end"
          fill="var(--muted-foreground)"
          className="font-mono text-[10px]"
        >
          {fmt(xMax)}
        </text>
      </svg>
    </div>
  )
}
