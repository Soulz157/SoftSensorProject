'use client'

import { Loader2 } from 'lucide-react'
import { pickTimeFormat } from '@/lib/monitoring'
import { buildFitRows, type FitPoint } from '@/lib/model-metrics'
import type { RunPredictionsBatchItem } from '@/services/model-draft'
import { ActualVsPredictedChart } from '../evaluation/actual-vs-predicted-chart'

interface Props {
  /** Null means no run has been recorded for this candidate slot yet
   *  (still queued to launch) — distinct from a run that IS recorded but
   *  has not succeeded. */
  runId: string | null
  /** The candidate's own decimated series, once the batch fetch resolves.
   *  Absent (not merely `undefined`-valued) means the run never reached
   *  `useCandidatePredictions`' request — not yet SUCCEEDED, or has no
   *  `predictionsKey` at all. */
  item: RunPredictionsBatchItem | undefined
  loading: boolean
  /** Small-multiple default. The overlay chart passes its own, larger value. */
  height?: number
}

/**
 * MODEL-FLOW-017-T04. The unconditional base chart — every terminal
 * candidate gets one, regardless of algorithm (finding 1). Reuses
 * `ActualVsPredictedChart` rather than a second implementation of the same
 * view; NO branch on algorithm name anywhere in this component (finding 6)
 * — every state below is keyed on the run's own recorded fields, never on
 * `candidate.algorithm`.
 */
export function CandidateBaseChart({
  runId,
  item,
  loading,
  height = 140,
}: Props) {
  if (!runId) return null

  if (loading) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ height }}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  if (!item) {
    return (
      <p className="text-[10px] text-muted-foreground">
        No predictions artifact recorded for this run.
      </p>
    )
  }

  if (item.error || item.points.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground">
        Predictions could not be read
        {item.error ? ` — ${item.error}` : '.'}
      </p>
    )
  }

  const points: FitPoint[] = item.points.map(p => ({
    timestamp: p.timestamp,
    actual: p.yTrue,
    predicted: p.yPred,
    residual: p.yTrue - p.yPred,
  }))
  const rows = buildFitRows(points, item.residualSd ?? 0)
  const first = rows[0]
  const last = rows[rows.length - 1]
  const tickFormatter = pickTimeFormat(first && last ? last.t - first.t : 0)

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium text-muted-foreground">
        Does it track reality?
      </p>
      <ActualVsPredictedChart
        rows={rows}
        tickFormatter={tickFormatter}
        height={height}
        syncId={`candidate-base-${runId}`}
      />
      {item.downsampled && (
        <p className="text-[9px] text-muted-foreground">
          {item.points.length} of {item.rowCount} points shown
        </p>
      )}
    </div>
  )
}
