'use client'

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatWallClockFull, pickTimeFormat } from '@/lib/monitoring'
import { buildOofSeries, foldColor, foldKey } from '@/lib/cv-oof'
import type {
  CvFoldRecord,
  RunPredictionsBatchItem,
} from '@/services/model-draft'
import {
  ACTUAL_COLOR,
  AXIS_TICK,
} from '../evaluation/actual-vs-predicted-chart'

interface Props {
  item: RunPredictionsBatchItem
  folds: CvFoldRecord[]
  height?: number
}

/**
 * MODEL-FLOW-028-T05. Actual vs OUT-OF-FOLD predicted for one CV run.
 *
 * One solid actual line and one predicted line per fold, each in its own
 * colour and drawn only across that fold's own test window, with the fold
 * boundaries marked. Every predicted point was made by a model that never
 * trained on that row — which is the point of the chart, and why it says so
 * rather than looking like an ordinary test-split plot.
 *
 * Not `ActualVsPredictedChart`: that one draws a single prediction series and
 * an SD band around it; here the unit of colour is the fold.
 */
export function CvOofChart({ item, folds, height = 220 }: Props) {
  const {
    rows,
    folds: foldNumbers,
    cuts,
    unassigned,
  } = buildOofSeries(item.points, folds)
  if (rows.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground">
        Out-of-fold predictions could not be placed on the folds.
      </p>
    )
  }
  const first = rows[0]
  const last = rows[rows.length - 1]
  const tickFormatter = pickTimeFormat(first && last ? last.t - first.t : 0)

  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={rows}
          syncId={`cv-oof-${item.runId ?? item.sourceKey}`}
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
            labelFormatter={v => formatWallClockFull(Number(v))}
            formatter={(value, name) => [
              typeof value === 'number' ? value.toFixed(3) : String(value),
              name,
            ]}
          />
          {cuts.map(cut => (
            <ReferenceLine
              key={cut.fold}
              x={cut.t}
              stroke="var(--border)"
              strokeDasharray="2 3"
            />
          ))}
          {foldNumbers.map((n, i) => (
            <Line
              key={n}
              name={`Fold ${n} predicted`}
              type="monotone"
              dataKey={foldKey(n)}
              stroke={foldColor(i)}
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              isAnimationActive={false}
            />
          ))}
          <Line
            name="Actual"
            type="monotone"
            dataKey="actual"
            stroke={ACTUAL_COLOR}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="h-0.5 w-3"
            style={{ backgroundColor: ACTUAL_COLOR }}
          />
          Actual
        </span>
        {foldNumbers.map((n, i) => (
          <span key={n} className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="h-0.5 w-3"
              style={{ backgroundColor: foldColor(i) }}
            />
            Fold {n}
          </span>
        ))}
      </div>
      <p className="text-[9px] text-muted-foreground">
        {item.points.length} of {item.rowCount} points shown
        {unassigned > 0
          ? ` · ${unassigned} before the first fold not plotted`
          : ''}
      </p>
    </div>
  )
}
