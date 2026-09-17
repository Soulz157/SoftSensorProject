'use client'

import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { LivePredictionPoint } from '@/hooks/model/use-prediction-monitoring'

interface Props {
  points: LivePredictionPoint[]
  /** MODEL-SERVE-008-T06. Optional, defaulting to false, so the original
   *  by-construction sentence stands for any caller that has not been
   *  taught about the driver yet — a new empty state must not arrive as a
   *  silent behaviour change in a caller that never opted into it. */
  livePredictEnabled?: boolean
}

/**
 * MODEL-SERVE-005. The sampled synchronous-/predict stream, plotted alone —
 * no actual/residual/SD bands, because none exist yet (T03, ground truth,
 * is blocked). Deliberately a separate, simpler chart from
 * `ActualVsPredictChart` rather than that component fed a fabricated
 * `actual` value.
 */
export function LivePredictionChart({
  points,
  livePredictEnabled = false,
}: Props) {
  if (points.length === 0) {
    // MODEL-SERVE-001-T10. This section reads PredictionLog, which ONLY
    // apps/serving's synchronous /predict path writes. A scheduled window
    // writes predictions.parquet and an InferenceWindow row instead — two
    // planes by decision (short_lived_containers_for_scheduled_inference),
    // not by oversight. So a model that has only ever been scheduled is
    // empty here BY CONSTRUCTION, and the old flat sentence sent readers
    // looking for a fault that does not exist. Name the stream, and point
    // at the sections that DO have data for such a model. It must not read
    // InferenceWindow to fill itself: a window's input is a different
    // artifact with a different shape, and merging them would make one
    // chart claim two provenances.
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          No synchronous /predict traffic has been logged for this model in this
          range.
        </p>
        {livePredictEnabled ? (
          // MODEL-SERVE-008-T06. The driver IS writing to this stream, so
          // the by-construction sentence below would name a cause that no
          // longer applies — and a section a reader trusts is worse wrong
          // than one that says nothing. The planes still do not merge: this
          // says only that the /predict plane now HAS a writer for this
          // model, never that a window wrote here.
          <p className="text-xs text-muted-foreground/70">
            Live prediction is on for this model, so this chart fills as
            predictions are scored. Nothing has landed in this range yet —
            scoring pauses whenever the historian is unreachable.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/70">
            This chart plots sampled live requests. Scheduled inference does not
            write here — it writes to the monitoring record, which feeds the
            Actual vs. Predict and Residual sections above.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={iso =>
              new Date(iso).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            }
            tick={{ fontSize: 10 }}
            stroke="var(--muted-foreground)"
          />
          <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
          <Tooltip
            labelFormatter={iso => new Date(iso as string).toLocaleString()}
            formatter={value => [
              typeof value === 'number' ? value.toFixed(4) : String(value),
              'Predicted',
            ]}
          />
          <Line
            type="monotone"
            dataKey="predicted"
            stroke="var(--chart-1)"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
