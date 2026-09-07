'use client'
import { useMemo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { FitRow } from '@/lib/model-metrics'
import { EvaluationTooltip } from './evaluation-tooltip'
import { AXIS_TICK, EVAL_SYNC_ID } from './actual-vs-predicted-chart'

interface Props {
  rows: FitRow[]
  /** Residual SD from the fit — drives the ±1/±2/±3 layer boundaries. */
  sd: number
  tickFormatter: (t: number) => string
  /** Name of the compared model — renders a second residual line. */
  compareName?: string
}

/**
 * Share of residuals falling in each SD band. Counted from zero OUTWARD, so
 * each figure describes the region its own label sits in rather than
 * everything inside it — same convention as the monitoring ResidualChart's
 * readout. Points beyond ±3 SD belong to no band and appear in no figure.
 */
function sdCoverage(
  rows: FitRow[],
  sd: number,
): Record<number, { up: number; down: number }> | null {
  if (!Number.isFinite(sd) || sd <= 0) return null

  const residuals = rows
    .map(r => r.residual)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (residuals.length === 0) return null

  const n = residuals.length
  const out: Record<number, { up: number; down: number }> = {}
  for (const k of [1, 2, 3]) {
    const limit = k * sd
    const inner = (k - 1) * sd
    let up = 0
    let down = 0
    for (const r of residuals) {
      if (r > inner && r <= limit) up++
      else if (r < -inner && r >= -limit) down++
    }
    out[k] = { up: (up / n) * 100, down: (down / n) * 100 }
  }
  return out
}

/** A ±k·SD guardline pair. */
/** A ±k·SD guardline pair, labelled with that band's own coverage. */
function SdGuard({
  sd,
  k,
  color,
  pct,
}: {
  sd: number
  k: number
  color: string
  pct?: { up: number; down: number }
}) {
  const y = sd * k
  return (
    <>
      <ReferenceLine
        y={y}
        stroke={color}
        strokeDasharray="3 3"
        strokeOpacity={0.5}
        ifOverflow="extendDomain"
        label={{
          value: pct ? `+${k} SD  ${pct.up.toFixed(1)}%` : `+${k} SD`,
          position: 'insideTopRight',
          dx: -4,
          fill: color,
          fontSize: 11,
          fontWeight: 600,
        }}
      />
      <ReferenceLine
        y={-y}
        stroke={color}
        strokeDasharray="3 3"
        strokeOpacity={0.5}
        ifOverflow="extendDomain"
        label={{
          value: pct ? `-${k} SD  ${pct.down.toFixed(1)}%` : `-${k} SD`,
          position: 'insideBottomRight',
          dx: -4,
          fill: color,
          fontSize: 11,
          fontWeight: 600,
        }}
      />
    </>
  )
}

/** Three nested SD layers: normal (±1) → elevated (±2) → out of spec (±3). */
function SdBackground({ sd }: { sd: number }) {
  return (
    <>
      <ReferenceArea
        y1={sd * 2}
        y2={sd * 3}
        fill="var(--destructive)"
        fillOpacity={0.15}
      />
      <ReferenceArea
        y1={sd}
        y2={sd * 2}
        fill="var(--chart-3)"
        fillOpacity={0.15}
      />
      <ReferenceArea
        y1={-sd}
        y2={sd}
        fill="var(--chart-2)"
        fillOpacity={0.25}
      />
      <ReferenceArea
        y1={-sd * 2}
        y2={-sd}
        fill="var(--chart-3)"
        fillOpacity={0.15}
      />
      <ReferenceArea
        y1={-sd * 3}
        y2={-sd * 2}
        fill="var(--destructive)"
        fillOpacity={0.15}
      />
    </>
  )
}

/**
 * Residual = Actual − Predicted over time, on 3-layer SD guardrails. A healthy
 * fit stays inside the ±1 SD band with no drift or structure; excursions into
 * the ±2 / ±3 layers mark the samples the model misses.
 */
export function ResidualChart({ rows, sd, tickFormatter, compareName }: Props) {
  const coverage = useMemo(() => sdCoverage(rows, sd), [rows, sd])
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart
        data={rows}
        syncId={EVAL_SYNC_ID}
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis
          dataKey="t"
          type="number"
          domain={['dataMin', 'dataMax']}
          scale="time"
          tickFormatter={tickFormatter}
          tick={AXIS_TICK}
          stroke="var(--border)"
          minTickGap={40}
        />
        <YAxis
          domain={['auto', 'auto']}
          tick={AXIS_TICK}
          stroke="var(--border)"
          width={48}
          tickFormatter={v => Number(v).toFixed(1)}
        />
        <Tooltip
          content={
            <EvaluationTooltip
              variant="residual"
              compareName={compareName}
              formatLabel={tickFormatter}
            />
          }
        />

        <SdBackground sd={sd} />
        <SdGuard sd={sd} k={1} color="var(--chart-2)" pct={coverage?.[1]} />
        <SdGuard sd={sd} k={2} color="var(--chart-3)" pct={coverage?.[2]} />
        <SdGuard sd={sd} k={3} color="var(--destructive)" pct={coverage?.[3]} />

        {/* Perfect-prediction baseline. */}
        <ReferenceLine
          y={0}
          stroke="var(--muted-foreground)"
          strokeDasharray="5 5"
          strokeOpacity={0.6}
        />

        <Area
          connectNulls
          type="monotone"
          dataKey="residual"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="var(--chart-1)"
          fillOpacity={0.12}
          dot={false}
          isAnimationActive={false}
        />

        {compareName && (
          <Line
            connectNulls
            type="monotone"
            dataKey="compareResidual"
            stroke="var(--chart-4)"
            strokeWidth={1.5}
            strokeDasharray="2 4"
            dot={false}
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
