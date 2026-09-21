'use client'

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { formatAxisValue } from '@/lib/monitoring'
import type {
  BrushWindow,
  LiveOverlayRow,
  MonitoringRow,
} from '@/lib/monitoring'
import { MonitoringTooltip } from './monitoring-tooltip'

export type { BrushWindow }

interface Props {
  /** MODEL-SERVE-008-T04. `LiveOverlayRow` widens `MonitoringRow` for the
   *  chart ONLY — a dense predicted point has no lab counterpart, so its row
   *  carries no `actual` and no `residual`. `EvalPoint` itself is untouched
   *  and stays non-optional, per MODEL-SERVE-005's recorded refusal. */
  rows: Array<MonitoringRow | LiveOverlayRow>
  /** MODEL-SERVE-011-T20. The visible index window, owned by
   *  `ChartZoomControls`. The Brush used to be the only thing that APPLIED
   *  it — with the Brush gone the chart slices its own data, or the zoom
   *  buttons would change state and nothing on screen. */
  brush: BrushWindow
  tickFormatter: (t: number) => string
  actualAsLine?: boolean
  yDomain?: [number, number] | undefined
}

const SYNC_ID = 'monitoring'
const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 }

export function ActualVsPredictChart({
  rows,
  brush,
  tickFormatter,
  actualAsLine = true,
  yDomain,
}: Props) {
  const startIndex = brush.startIndex ?? 0
  const endIndex = brush.endIndex ?? Math.max(0, rows.length - 1)
  // `endIndex` is INCLUSIVE, the convention `ChartZoomControls` and recharts'
  // Brush both use, hence the +1.
  const visible = rows.slice(startIndex, endIndex + 1)

  return (
    <div className="w-full overflow-x-auto overflow-y-hidden">
      {/* The horizontal scroller is kept for NARROW screens — a time-series
          axis below ~375px is unreadable, and DESIGN_SYSTEM's responsive
          rule allows a chart its own `overflow-x-auto` container for exactly
          that reason. What changed is that the inner track no longer forces
          that minimum on screens that do not need it: `min-w-375` applied at
          every width, so a wide screen rendered a 375px-minimum track inside
          a much wider card and the chart never filled it. From xl up the
          track takes the full card. */}
      <div className="min-w-375 xl:w-full xl:min-w-0">
        <ResponsiveContainer className="w-full" height={500}>
          <ComposedChart
            data={visible}
            syncId={SYNC_ID}
            margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
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
              domain={yDomain ?? ['auto', 'auto']}
              tick={AXIS_TICK}
              stroke="var(--border)"
              // MODEL-SERVE-011-T21. Wide enough for four significant digits
              // plus a sign; the previous 44px clipped the unformatted float
              // this axis used to print.
              width={78}
              tickFormatter={formatAxisValue}
            />
            <Tooltip
              content={
                <MonitoringTooltip variant="main" formatLabel={tickFormatter} />
              }
            />

            {/* <Area
              connectNulls
              dataKey="sd3"
              stroke="none"
              fill="var(--destructive)"
              fillOpacity={0.12}
              isAnimationActive={false}
              activeDot={false}
            /> */}
            {/* <Area
              connectNulls
              dataKey="sd2"
              stroke="none"
              fill="var(--chart-3)"
              fillOpacity={0.16}
              isAnimationActive={false}
              activeDot={false}
            /> */}
            <Area
              connectNulls
              dataKey="sd1"
              stroke="none"
              fill="var(--chart-2)"
              fillOpacity={0.42}
              isAnimationActive={false}
              activeDot={false}
            />

            {/* MODEL-SERVE-008-T04. The DENSE serving-plane series, drawn
                BENEATH the window-plane prediction so the sparse, ground-
                truth-paired series stays the visually dominant one — this
                chart's subject is still Actual vs Predict, and the dense
                line is context for it. `connectNulls` spans the gaps
                between dense points on purpose: they are one continuous
                series sampled at its own cadence, not a series with holes.
                A gap where the historian was unreachable is therefore a
                straight segment, which is why the coverage strip states the
                counts rather than leaving a reader to infer them. */}
            {/* MODEL-SERVE-009-T05. The target's last REPORTED value, drawn
                as a step because that is what it IS — one measurement
                carried forward by PI between lab samples, not a series of
                readings. Its own dataKey, never `actual`: `actual` feeds
                the residual and the SD band, and a held number in those
                would publish a confident error against a value nobody
                measured in that interval. Labelled "Actual" in the legend
                per the operator's decision; the tooltip and the caption
                carry when it was actually measured. */}
            <Line
              connectNulls
              type="stepAfter"
              dataKey="held"
              // MODEL-SERVE-011-T11. `held` wears the ACTUAL identity on
              // screen, so it takes the Actual colour — the legend names one
              // Actual, and two colours under one legend entry is the
              // one-name-two-things shape this tab already refuses
              // elsewhere. The DASHED STEP is what keeps it distinguishable
              // from a measured reading, not a separate hue.
              stroke="var(--chart-1)"
              strokeOpacity={0.55}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />

            {/* MODEL-SERVE-011-T13. The LIVE series was removed from this
                chart (user decision 2026-09-17). It reads the serving plane
                — one instant through the warm /predict — while this chart is
                now the WINDOW plane's own comparison: predictions and the
                measured actual that came from the same window, at the same
                time. Mixing a per-instant series into that put two cadences
                and two artifacts on one axis. The live stream keeps its own
                section below, unchanged; `LiveOverlayRow.live` also stays,
                because the Residual chart and `mergeLivePredictions` still
                populate it. */}

            {/* MODEL-SERVE-011-T12. The SCHEDULED plane: one point per
                window, `predictionMean` over that window's own 60 scored
                rows. Its own key, its own colour and VISIBLE DOTS, because
                it is hourly against two dense series — a bare line at this
                cadence reads as a sparse version of the others rather than
                a different measurement. `stepAfter` would imply the value
                holds across the hour, which it does not: it is a summary of
                the hour, so the dots carry the meaning and the line only
                connects them. */}
            <Line
              connectNulls
              type="monotone"
              dataKey="scheduled"
              stroke="var(--foreground)"
              strokeWidth={2}
              // Dotted, not dashed: at one point per hour the stroke between
              // markers is interpolation, not measurement. It also keeps this
              // series readable beside `predict`'s longer dash now that both
              // wear the same Predict colour.
              strokeDasharray="2 4"
              dot={{ r: 3, fill: 'var(--foreground)', strokeWidth: 0 }}
              activeDot={{
                r: 5,
                fill: 'var(--foreground)',
                stroke: 'var(--background)',
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />

            <Line
              connectNulls
              type="monotone"
              dataKey="predict"
              // MODEL-SERVE-011-T13. The same Predict colour the hourly
              // series wears: both are this window plane's own predictions,
              // and the legend now carries one entry for them. The dash
              // still separates per-row pairs from the hourly summary.
              stroke="var(--foreground)"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              isAnimationActive={false}
            />

            <Line
              connectNulls
              type="monotone"
              dataKey="actual"
              stroke="var(--chart-1)"
              strokeOpacity={actualAsLine ? 1 : 0.35}
              strokeWidth={actualAsLine ? 2 : 1}
              dot={
                actualAsLine
                  ? false
                  : { r: 2.5, fill: 'var(--chart-1)', strokeWidth: 0 }
              }
              activeDot={{
                r: 5,
                fill: 'var(--chart-1)',
                stroke: 'var(--background)',
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
