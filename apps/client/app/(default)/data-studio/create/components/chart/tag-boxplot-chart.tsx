'use client'

import { useMemo } from 'react'
import { BoxSelect } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'
import type { DraftBoxplotResult } from '@/services/dataset-draft'

/**
 * DS-LAKE-005B-D-T03. Consumes the SERVER box plot response — five-number
 * summary + 1.5×IQR whiskers + capped outlier list are computed by
 * `boxplot_service.py`, not this component. `Dataset` is deliberately NOT
 * accepted here (same DS-LAKE-005B-D-V05 type gate `TagHistogramChart`
 * applies) — a caller cannot hand this component a bare full-frame dataset
 * even by accident.
 *
 * `status` mirrors `TagHistogramChart`'s exact union and reasoning —
 * see that component's own doc comment for 'no-tags'/'pending'/'loading'.
 */
interface Props {
  data: DraftBoxplotResult | null
  tags: string[]
  status: 'no-tags' | 'pending' | 'loading' | 'ready'
}

const CHART_HEIGHT = 500
const Y_TICK_COUNT = 6

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min]
  const range = max - min
  const rawStep = range / Math.max(1, count - 1)
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const residual = rawStep / magnitude
  let step: number
  if (residual >= 7.5) step = 10 * magnitude
  else if (residual >= 3.5) step = 5 * magnitude
  else if (residual >= 1.5) step = 2 * magnitude
  else step = magnitude

  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Math.round(v / step) * step)
  }
  return ticks
}

interface BoxRow {
  tag: string
  color: string
  min: number
  q1: number
  median: number
  mean: number
  q3: number
  max: number
  whiskerLow: number
  whiskerHigh: number
  outliers: number[]
  outlierCount: number
  iqr: [number, number]
  showLabels: boolean
}

type BoxShapeProps = {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: BoxRow
}

function BoxWhiskerShape(props: BoxShapeProps) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props
  if (!payload) return <g />
  const {
    q1,
    q3,
    median,
    mean,
    whiskerLow,
    whiskerHigh,
    outliers,
    color,
    showLabels,
  } = payload

  const span = q3 - q1
  const pxPerUnit = span !== 0 ? height / span : 0
  const toY = (v: number) => y + (q3 - v) * pxPerUnit

  const cx = x + width / 2
  const capHalf = Math.min(width * 0.32, 14)

  const wLowY = toY(whiskerLow)
  const wHighY = toY(whiskerHigh)
  const medianY = toY(median)
  const meanY = toY(mean)
  const meanFinite = Number.isFinite(meanY)

  return (
    <g>
      {/* whisker line (behind the box) */}
      <line
        x1={cx}
        x2={cx}
        y1={wLowY}
        y2={wHighY}
        stroke="var(--muted-foreground)"
        strokeWidth={1.5}
      />
      {/* whisker caps */}
      <line
        x1={cx - capHalf}
        x2={cx + capHalf}
        y1={wHighY}
        y2={wHighY}
        stroke="var(--muted-foreground)"
        strokeWidth={1.5}
      />
      <line
        x1={cx - capHalf}
        x2={cx + capHalf}
        y1={wLowY}
        y2={wLowY}
        stroke="var(--muted-foreground)"
        strokeWidth={1.5}
      />

      <rect
        x={x}
        y={Math.min(y, y + height)}
        width={width}
        height={Math.abs(height)}
        fill={color}
        fillOpacity={0.25}
        stroke={color}
        strokeWidth={1.5}
        rx={3}
      />

      {/* median — solid horizontal line across the box */}
      <line
        x1={x}
        x2={x + width}
        y1={medianY}
        y2={medianY}
        stroke={color}
        strokeWidth={2.5}
      />

      {meanFinite && (
        <>
          <line
            x1={x}
            x2={x + width}
            y1={meanY}
            y2={meanY}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="3 2"
            opacity={0.9}
          />
          <path
            d={`M ${x - 5} ${meanY} L ${x} ${meanY - 4} L ${x + 5} ${meanY} L ${x} ${meanY + 4} Z`}
            fill="var(--card)"
            stroke={color}
            strokeWidth={1.5}
          />
        </>
      )}

      {/* outliers — hollow rings so they read as "outside" the distribution.
          `outliers` is the CAPPED list; `payload.outlierCount` (shown in the
          tooltip) is the true total, which may exceed what's plotted here. */}
      {outliers.map((v, i) => (
        <circle
          key={`${v}-${i}`}
          cx={cx}
          cy={toY(v)}
          r={4}
          fill="var(--card)"
          stroke={color}
          strokeWidth={1.5}
        >
          <title>{`outlier: ${fmt(v)}`}</title>
        </circle>
      ))}

      {/* Inline value labels — Q3 (top-right), Q1 (bottom-right), Mean (left) */}
      {showLabels && (
        <>
          <text
            x={x + width + 6}
            y={toY(q3)}
            dy={-2}
            textAnchor="start"
            className="font-mono text-[12px] font-medium"
            fill="var(--muted-foreground)"
          >
            {`Q3 ${fmt(q3)}`}
          </text>
          <text
            x={x + width + 6}
            y={toY(q1)}
            dy={10}
            textAnchor="start"
            className="font-mono text-[12px] font-medium"
            fill="var(--muted-foreground)"
          >
            {`Q1 ${fmt(q1)}`}
          </text>
          {meanFinite && (
            <text
              x={x - 6}
              y={meanY}
              dy={4}
              textAnchor="end"
              className="font-mono text-[12px] font-semibold"
              fill={color}
            >
              {`Mean ${fmt(mean)}`}
            </text>
          )}
        </>
      )}
    </g>
  )
}

export function TagBoxplotChart({ data, tags, status }: Props) {
  const insufficientTags = data?.insufficient_tags ?? []

  const rows = useMemo<BoxRow[]>(() => {
    if (!data) return []
    const byTag = new Map(data.tags.map(t => [t.tag, t]))
    const showLabels = data.tags.length <= 5
    return tags.flatMap(tag => {
      const t = byTag.get(tag)
      if (!t) return []
      return [
        {
          tag,
          color: chartColorVar(resolveTagMeta(tag).chartIndex),
          min: t.min,
          q1: t.q1,
          median: t.median,
          mean: t.mean,
          q3: t.q3,
          max: t.max,
          whiskerLow: t.whisker_low,
          whiskerHigh: t.whisker_high,
          outliers: t.outliers,
          outlierCount: t.outlier_count,
          iqr: [t.q1, t.q3] as [number, number],
          showLabels,
        },
      ]
    })
  }, [data, tags])

  if (status === 'no-tags') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <BoxSelect className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Select a tag to compare above.
        </p>
      </div>
    )
  }

  if (status === 'pending') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <BoxSelect className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Save cleaned tags to build a box plot.
        </p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <BoxSelect className="h-8 w-8 animate-pulse text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Loading box plot…</p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <BoxSelect className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Not enough values to build a box plot for{' '}
          <span className="font-mono">{tags.join(', ')}</span>
        </p>
      </div>
    )
  }

  const rawMin = Math.min(...rows.map(r => Math.min(r.min, ...r.outliers)))
  const rawMax = Math.max(...rows.map(r => Math.max(r.max, ...r.outliers)))
  const ticks = niceTicks(rawMin, rawMax, Y_TICK_COUNT)
  const domain: [number, number] = [ticks[0]!, ticks[ticks.length - 1]!]

  const chartConfig = rows.reduce((acc, r) => {
    acc[r.tag] = { label: r.tag, color: r.color }
    return acc
  }, {} as ChartConfig)

  return (
    <div className="space-y-2">
      <ChartContainer
        config={chartConfig}
        style={{ height: CHART_HEIGHT }}
        className="w-full"
      >
        <BarChart
          data={rows}
          margin={{ top: 16, right: 60, bottom: 8, left: 8 }}
          barCategoryGap="20%"
        >
          <CartesianGrid horizontal vertical={false} strokeDasharray="3 3" />
          <XAxis
            type="category"
            dataKey="tag"
            tick={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
            }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="number"
            domain={domain}
            ticks={ticks}
            tickFormatter={fmt}
            width={56}
            tick={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}
          />
          <ChartTooltip
            cursor={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]?.payload as BoxRow | undefined
              if (!row) return null
              return (
                <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
                  <p
                    className="mb-1 font-mono font-semibold"
                    style={{ color: row.color }}
                  >
                    {row.tag}
                  </p>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                    <dt>Min</dt>
                    <dd className="text-right text-foreground">
                      {fmt(row.min)}
                    </dd>
                    <dt>Q1</dt>
                    <dd className="text-right text-foreground">
                      {fmt(row.q1)}
                    </dd>
                    <dt>Median</dt>
                    <dd className="text-right text-foreground">
                      {fmt(row.median)}
                    </dd>
                    <dt>Mean</dt>
                    <dd className="text-right text-foreground">
                      {fmt(row.mean)}
                    </dd>
                    <dt>Q3</dt>
                    <dd className="text-right text-foreground">
                      {fmt(row.q3)}
                    </dd>
                    <dt>Max</dt>
                    <dd className="text-right text-foreground">
                      {fmt(row.max)}
                    </dd>
                    {row.outlierCount > 0 && (
                      <>
                        <dt>Outliers</dt>
                        <dd className="text-right text-foreground">
                          {row.outlierCount}
                          {row.outliers.length < row.outlierCount && (
                            <span className="text-muted-foreground">
                              {' '}
                              ({row.outliers.length} shown)
                            </span>
                          )}
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
              )
            }}
          />
          <Bar
            dataKey="iqr"
            shape={BoxWhiskerShape}
            isAnimationActive={false}
            maxBarSize={40}
          />
        </BarChart>
      </ChartContainer>

      <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-foreground/70" /> Median
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t-2 border-dashed border-foreground/70" />{' '}
          Mean
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full ring-1 ring-foreground/70" />{' '}
          Outlier
        </span>
      </div>

      {insufficientTags.length > 0 && (
        <p className="text-center font-mono text-[10px] text-muted-foreground">
          Not enough values for {insufficientTags.join(', ')}
        </p>
      )}
    </div>
  )
}
