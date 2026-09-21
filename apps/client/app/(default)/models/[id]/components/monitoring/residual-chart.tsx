'use client'

import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  ReferenceArea,
} from 'recharts'
import { formatAxisValue } from '@/lib/monitoring'
import type {
  BrushWindow,
  LiveOverlayRow,
  MonitoringRow,
} from '@/lib/monitoring'
import { MonitoringTooltip } from './monitoring-tooltip'
import { useMemo } from 'react'

export type ResidualMode = 'abs' | 'pct'

interface Props {
  /** MODEL-SERVE-009-T05 follow-up. `LiveOverlayRow` widens `MonitoringRow`
   *  for the chart only — a row carrying a prediction and a HELD lab value
   *  has no measured `actual` and therefore no true residual. */
  rows: Array<MonitoringRow | LiveOverlayRow>
  /** MODEL-SERVE-011-T20. The visible index window from
   *  `ChartZoomControls`; the chart slices its own data now that the Brush
   *  that used to apply it is gone. */
  brush: BrushWindow
  tickFormatter: (t: number) => string
  /** Window residual SD — drives the ±1/±2/±3 guardlines (absolute mode). */
  sd: number
  /**
   * MODEL-SERVE-011-T16. WHICH spread `sd` describes.
   *
   * `residual` is the real one: `actual − predicted` where the actual was
   * measured in that interval. `held` is the fallback the chart can draw
   * before any lab sample has joined — the spread of `predicted − held`,
   * i.e. distance from the last value the lab reported, which is model
   * CONSISTENCY and not model error. The guardlines look identical, so the
   * basis has to be stated rather than inferred from the picture.
   */
  sdBasis?: 'residual' | 'held'
  mode: ResidualMode
}

/**
 * MODEL-SERVE-011-T16. The colours this chart draws with, named ONCE here so
 * the legend beside it cannot claim a colour the chart does not use — the
 * same binding `create/components/pipeline/evaluation/residual-chart.tsx`
 * establishes for the evaluation flow (its own MODEL-FLOW-019-T17). The tab
 * had these five literals a second time, which is exactly the drift that
 * discipline exists to prevent.
 */
export const RESIDUAL_COLOR = 'var(--chart-1)'
export const SD1_COLOR = 'var(--chart-2)'
export const SD2_COLOR = 'var(--chart-3)'
export const SD3_COLOR = 'var(--destructive)'

const SYNC_ID = 'monitoring'
const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 }

function sdCoverage(
  rows: Array<MonitoringRow | LiveOverlayRow>,
  sd: number,
  basis: 'residual' | 'held' = 'residual',
): Record<number, { up: number; down: number }> | null {
  if (!Number.isFinite(sd) || sd <= 0) return null

  // MODEL-SERVE-011-T16. Reads the series the guardlines were computed FROM,
  // never a mix: counting measured residuals against a held-based SD (or the
  // reverse) would put a percentage under a line it does not describe.
  const residuals = rows
    .map(r =>
      basis === 'held' ? (r as LiveOverlayRow).heldDeviation : r.residual,
    )
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (residuals.length === 0) return null

  const n = residuals.length
  const out: Record<number, { up: number; down: number }> = {}
  for (const k of [1, 2, 3]) {
    const limit = k * sd
    // Counted from zero OUTWARD to the line, so each figure describes the
    // region its own label sits in rather than everything inside it.
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

/**
 * Room reserved to the RIGHT of the plot for the SD labels, which sit in the
 * margin rather than over the data. Wide enough for the longest string these
 * labels produce (`-3 SD  100.0%`) at 12px.
 */
const SD_LABEL_GUTTER = 104

/** A ±k·SD guardline pair (absolute-error mode only). */
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

  /**
   * Both labels of a pair share this shape. `position: 'right'` puts each one
   * at its OWN line's end, in the right-hand gutter.
   *
   * REPLACES an insideTop/insideBottom pair staggered by `dx = (k - 2) * 90`.
   * That stagger existed only because all three positive labels were pinned
   * to the top of the plot and would otherwise have stacked on each other —
   * it spread them sideways ACROSS the data, so a label could sit far from
   * the line it described and on top of the residual series. Anchoring each
   * label to its own line's height separates the three vertically for free,
   * with no offset arithmetic and nothing drawn over the data.
   */
  const label = (value: string) => ({
    value,
    position: 'right' as const,
    offset: 8,
    fill: color,
    fontSize: 12,
    fontWeight: 600,
  })

  return (
    <>
      <ReferenceLine
        y={y}
        stroke={color}
        strokeDasharray="3 3"
        strokeOpacity={0.6}
        ifOverflow="extendDomain"
        label={label(pct ? `+${k} SD  ${pct.up.toFixed(1)}%` : `+${k} SD`)}
      />
      <ReferenceLine
        y={-y}
        stroke={color}
        strokeDasharray="3 3"
        strokeOpacity={0.6}
        ifOverflow="extendDomain"
        label={label(pct ? `-${k} SD  ${pct.down.toFixed(1)}%` : `-${k} SD`)}
      />
    </>
  )
}

function SdBackground({ sd }: { sd: number }) {
  return (
    <>
      <ReferenceArea
        y1={sd * 2}
        y2={sd * 3}
        fill={SD3_COLOR}
        fillOpacity={0.15}
      />

      {/* Positive: +1 SD → +2 SD */}
      <ReferenceArea y1={sd} y2={sd * 2} fill={SD2_COLOR} fillOpacity={0.15} />

      {/* Normal: -1 SD → +1 SD */}
      <ReferenceArea y1={-sd} y2={sd} fill={SD1_COLOR} fillOpacity={0.25} />

      {/* Negative: -2 SD → -1 SD */}
      <ReferenceArea
        y1={-sd * 2}
        y2={-sd}
        fill={SD2_COLOR}
        fillOpacity={0.15}
      />

      {/* Negative: -3 SD → -2 SD */}
      <ReferenceArea
        y1={-sd * 3}
        y2={-sd * 2}
        fill={SD3_COLOR}
        fillOpacity={0.15}
      />
    </>
  )
}

export function ResidualChart({
  rows,
  brush,
  tickFormatter,
  sd,
  sdBasis = 'residual',
  mode,
}: Props) {
  const isPct = mode === 'pct'
  // MODEL-SERVE-011-T20. Same inclusive-endIndex convention the zoom
  // controls use; sliced here because the Brush that used to apply the
  // window is gone.
  const visible = rows.slice(
    brush.startIndex ?? 0,
    (brush.endIndex ?? Math.max(0, rows.length - 1)) + 1,
  )
  const dataKey = isPct ? 'percentageError' : 'residual'

  // MODEL-SERVE-009-T05 follow-up. Rendered ONLY when no measured residual
  // exists in range — a real residual always wins, because it is the thing
  // this chart is named for. The deviation is the fallback that keeps the
  // card informative while the lab has not reported, not a second opinion
  // competing with the real one.
  const hasMeasuredResidual = rows.some(
    r => typeof (r as MonitoringRow).residual === 'number',
  )
  // MODEL-SERVE-011-T17. Drawn in BOTH modes now: percent mode used to be
  // excluded because these rows carry no `percentageError` (that needs a
  // measured actual), which left the chart empty for exactly the ranges this
  // series exists to cover. `heldDeviationPct` is its own percent counterpart.
  const showHeldDeviation =
    !hasMeasuredResidual &&
    rows.some(r => typeof (r as LiveOverlayRow).heldDeviation === 'number')

  const coverage = useMemo(
    () => (isPct ? null : sdCoverage(rows, sd, sdBasis)),
    [isPct, rows, sd, sdBasis],
  )

  return (
    // Structurally identical to `ActualVsPredictChart`'s root, deliberately:
    // the two charts sit in the same card shape, share a `syncId`, and must
    // size the same way at every breakpoint. This one returned a bare
    // `ResponsiveContainer` into a `min-h-0 flex-1` parent, which is exactly
    // the case where a percentage-sized SVG has no definite width to resolve
    // against — so it did not fill the widened card while its twin did. The
    // narrow-screen scroller is kept for the same reason as there: a
    // time-series axis below ~375px is unreadable.
    <div className="w-full overflow-x-auto overflow-y-hidden">
      <div className="min-w-375 xl:w-full xl:min-w-0">
        <ResponsiveContainer className="w-full" height={500}>
          <ComposedChart
            data={visible}
            syncId={SYNC_ID}
            // The right margin carries the SD labels in absolute mode. Percent
            // mode draws no guardlines, so it keeps the narrow gutter and the
            // plot stays as wide as it was.
            margin={{
              top: 8,
              right: isPct ? 24 : SD_LABEL_GUTTER,
              left: 0,
              bottom: 0,
            }}
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
              width={68}
              tickFormatter={v =>
                isPct
                  ? `${formatAxisValue(Number(v))}%`
                  : formatAxisValue(Number(v))
              }
            />
            <Tooltip
              content={
                <MonitoringTooltip
                  variant="residual"
                  residualMode={mode}
                  formatLabel={tickFormatter}
                />
              }
            />

            {/* Perfect-prediction baseline. */}
            <ReferenceLine
              y={0}
              stroke="var(--muted-foreground)"
              strokeDasharray="5 5"
              strokeOpacity={0.6}
            />

            {!isPct && (
              <>
                <SdBackground sd={sd} />

                <SdGuard sd={sd} k={1} color={SD1_COLOR} pct={coverage?.[1]} />
                <SdGuard sd={sd} k={2} color={SD2_COLOR} pct={coverage?.[2]} />
                <SdGuard sd={sd} k={3} color={SD3_COLOR} pct={coverage?.[3]} />
              </>
            )}

            {showHeldDeviation && (
              // Dashed and unfilled, unlike the measured residual's solid
              // filled area: the two must never look like the same
              // measurement. Its own key, so nothing that reads `residual`
              // — the SD band, RMSE, R2 — can pick it up by accident.
              <Area
                type="monotone"
                dataKey={isPct ? 'heldDeviationPct' : 'heldDeviation'}
                stroke={RESIDUAL_COLOR}
                strokeWidth={2}
                strokeDasharray="5 5"
                fill="none"
                isAnimationActive={false}
                dot={false}
              />
            )}

            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={RESIDUAL_COLOR}
              strokeWidth={2}
              fill={RESIDUAL_COLOR}
              fillOpacity={0.12}
              isAnimationActive={false}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
