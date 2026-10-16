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
  ReferenceDot,
} from 'recharts'
import { formatAxisValue } from '@/lib/monitoring'
import {
  CLIP_SD,
  MIN_BAND_POINTS,
  bandCoverage,
  beyondBandCounts,
  residualBand,
  type ResidualOutlier,
} from '@/lib/residual-band'
import type {
  BrushWindow,
  LiveOverlayRow,
  MonitoringRow,
} from '@/lib/monitoring'
import { MonitoringTooltip } from './monitoring-tooltip'
import { useMemo } from 'react'
import { TriangleAlert } from 'lucide-react'

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
  tooltipFormatter: (t: number) => string
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
  /** The serving version's own test-split residual SD. Draws the bands while
   *  the range has too few points (or no spread) for a live SD of its own. */
  referenceSd?: number | null
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

/**
 * Room reserved to the RIGHT of the plot for the SD labels, which sit in the
 * margin rather than over the data. Wide enough for the longest string these
 * labels produce (`-3 SD  100.0%`) at 12px.
 */
const SD_LABEL_GUTTER = 104

/** A ±k·SD guardline pair around 0 (absolute-error mode only). */
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
        label={label(pct ? `+${k} SD  ${pct.up.toFixed(1)}%` : `+${k} SD`)}
      />
      <ReferenceLine
        y={-y}
        stroke={color}
        strokeDasharray="3 3"
        strokeOpacity={0.6}
        label={label(pct ? `-${k} SD  ${pct.down.toFixed(1)}%` : `-${k} SD`)}
      />
    </>
  )
}

/** The ±1/2/3 SD bands around 0 — distance from a perfect prediction. */
function SdBackground({ sd }: { sd: number }) {
  const at = (k: number) => k * sd
  return (
    <>
      <ReferenceArea
        y1={at(2)}
        y2={at(3)}
        fill={SD3_COLOR}
        fillOpacity={0.15}
      />
      <ReferenceArea
        y1={at(1)}
        y2={at(2)}
        fill={SD2_COLOR}
        fillOpacity={0.15}
      />
      <ReferenceArea
        y1={at(-1)}
        y2={at(1)}
        fill={SD1_COLOR}
        fillOpacity={0.25}
      />
      <ReferenceArea
        y1={at(-2)}
        y2={at(-1)}
        fill={SD2_COLOR}
        fillOpacity={0.15}
      />
      <ReferenceArea
        y1={at(-3)}
        y2={at(-2)}
        fill={SD3_COLOR}
        fillOpacity={0.15}
      />
    </>
  )
}

/**
 * A point beyond CLIP_SD·SD of the bulk of the data, drawn as an arrow at the
 * clip limit so
 * it cannot stretch the axis and squash the bands. Its real value is in the
 * chart tooltip and in this marker's own title.
 */
function OutlierArrow({
  cx,
  cy,
  outlier,
}: {
  cx?: number
  cy?: number
  outlier: ResidualOutlier
}) {
  if (cx === undefined || cy === undefined) return null
  const up = outlier.edge === 'top'
  const d = up
    ? `M ${cx} ${cy - 6} L ${cx - 6} ${cy + 4} L ${cx + 6} ${cy + 4} Z`
    : `M ${cx} ${cy + 6} L ${cx - 6} ${cy - 4} L ${cx + 6} ${cy - 4} Z`
  return (
    <path d={d} fill={SD3_COLOR} stroke="var(--background)" strokeWidth={1}>
      <title>{`Off the scale: ${formatAxisValue(outlier.value)} (beyond ${CLIP_SD} SD)`}</title>
    </path>
  )
}

export function ResidualChart({
  rows,
  brush,
  tickFormatter,
  tooltipFormatter,
  sd,
  sdBasis = 'residual',
  referenceSd = null,
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

  // The series the guardrails describe — never a mix: counting measured
  // residuals against a held-based SD (or the reverse) would put a figure
  // under a line it does not describe (MODEL-SERVE-011-T16).
  const series = useMemo(
    () =>
      visible
        .map(r => ({
          t: r.t,
          value:
            sdBasis === 'held'
              ? (r as LiveOverlayRow).heldDeviation
              : (r as MonitoringRow).residual,
        }))
        .filter(
          (p): p is { t: number; value: number } =>
            typeof p.value === 'number' && Number.isFinite(p.value),
        ),
    [visible, sdBasis],
  )
  // 2026-10-16. Bands around 0, hidden with too few points, an axis that
  // always shows them, far points clipped — see lib/residual-band.ts.
  const band = useMemo(
    () => (isPct ? null : residualBand(series, sd, referenceSd)),
    [isPct, series, sd, referenceSd],
  )
  const coverage = useMemo(
    () =>
      band?.show
        ? bandCoverage(
            series.map(p => p.value),
            band.sd,
          )
        : null,
    [band, series],
  )
  const shownBand = band?.show ? band : null
  // How far outside the bands the points sit, in words: a biased model can
  // be so far beyond ±3 SD that the bands alone cannot show it.
  const beyond = useMemo(
    () =>
      shownBand
        ? beyondBandCounts(
            series.map(p => p.value),
            shownBand.sd,
          )
        : null,
    [shownBand, series],
  )
  const beyondText =
    beyond && beyond.above + beyond.below > 0
      ? [
          beyond.below > 0 &&
            `${beyond.below} of ${beyond.n} points below −3 SD`,
          beyond.above > 0 &&
            `${beyond.above} of ${beyond.n} points above +3 SD`,
        ]
          .filter(Boolean)
          .join(' · ')
      : null

  return (
    <div className="w-full">
      {(beyondText || shownBand?.sdSource === 'reference') && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          {beyondText && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 font-medium text-foreground">
              <TriangleAlert className="h-3.5 w-3.5 text-muted-foreground" />
              {beyondText}
            </span>
          )}
          {shownBand?.sdSource === 'reference' && (
            <span className="text-muted-foreground">
              {`SD ${formatAxisValue(shownBand.sd)} from the training test set — this range has too few points for its own.`}
            </span>
          )}
        </div>
      )}
      {band && !band.show && series.length > 0 && (
        <p className="mb-2 text-xs text-muted-foreground">
          {band.reason === 'few-points'
            ? `SD guardrails appear once there are at least ${MIN_BAND_POINTS} points (${band.n} so far).`
            : 'SD guardrails need some spread: every point here has the same value.'}
        </p>
      )}
      {/* Structurally identical to `ActualVsPredictChart`'s root, deliberately:
        the two charts sit in the same card shape, share a `syncId`, and must
        size the same way at every breakpoint. This one returned a bare
        `ResponsiveContainer` into a `min-h-0 flex-1` parent, which is exactly
        the case where a percentage-sized SVG has no definite width to resolve
        against — so it did not fill the widened card while its twin did. The
        narrow-screen scroller is kept for the same reason as there: a
        time-series axis below ~375px is unreadable. */}
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
                domain={shownBand ? shownBand.domain : ['auto', 'auto']}
                // With bands shown the domain is fixed on purpose: an outlier
                // is clipped to the edge (and marked) instead of stretching it.
                allowDataOverflow={shownBand !== null}
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
                    formatLabel={tooltipFormatter}
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

              {shownBand && (
                <>
                  <SdBackground sd={shownBand.sd} />

                  {[1, 2, 3].map(k => (
                    <SdGuard
                      key={k}
                      sd={shownBand.sd}
                      k={k}
                      color={[SD1_COLOR, SD2_COLOR, SD3_COLOR][k - 1]!}
                      pct={coverage?.[k as 1 | 2 | 3]}
                    />
                  ))}
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

              {shownBand?.outliers.map(o => (
                <ReferenceDot
                  key={`outlier-${o.t}`}
                  x={o.t}
                  y={o.drawAt}
                  r={0}
                  shape={(props: { cx?: number; cy?: number }) => (
                    <OutlierArrow cx={props.cx} cy={props.cy} outlier={o} />
                  )}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
