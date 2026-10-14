/**
 * MODEL-SERVE-032. What the Evaluation page may send to PI, and when it must
 * refuse to. Pure, no IO.
 */

import { activeLab, type LabRow } from '@/lib/backfill-lab'
import type {
  EvaluationCompareResult,
  WriteBackConfigView,
  WriteBackKind,
} from '@/services/model-backfill'

/** Mirrors the server's per-batch cap. */
export const WRITE_MAX_POINTS = 2000

export interface WritePoint {
  timestamp: string
  value: number
}

/** Scored rows only: an unscored row has no prediction to write, and writing
 *  a placeholder into the plant historian would be worse than a gap. */
export function predictionPoints(
  data: Pick<EvaluationCompareResult, 'points'>,
): WritePoint[] {
  const out: WritePoint[] = []
  for (const p of data.points) {
    if (p.predicted !== null && Number.isFinite(p.predicted)) {
      out.push({ timestamp: p.t, value: p.predicted })
    }
  }
  return out
}

/** The lab series as it stands on the page (edits applied, removals out). */
export function labPointsToWrite(rows: readonly LabRow[]): WritePoint[] {
  return activeLab(rows)
}

export function pointsFor(
  kind: WriteBackKind,
  data: Pick<EvaluationCompareResult, 'points'>,
  rows: readonly LabRow[],
): WritePoint[] {
  return kind === 'PREDICTION' ? predictionPoints(data) : labPointsToWrite(rows)
}

/**
 * Why a write is not available right now, as a sentence — or null when it is.
 * The server enforces every one of these again; this is for saying so before
 * a click rather than after one.
 */
export function writeBlocker(input: {
  kind: WriteBackKind
  view: WriteBackConfigView | null
  data: Pick<EvaluationCompareResult, 'points'> | null
  rows: readonly LabRow[]
}): string | null {
  const { kind, view, data, rows } = input
  if (!view) return 'Loading write-back settings…'
  if (!view.canWrite) {
    return 'Only a workspace owner or an admin can write to PI.'
  }
  if (!view.source) return 'This model has no production data source.'
  if (!view.source.writable) {
    return `Write-back targets PI; this model's source is ${view.source.type}.`
  }
  if (view.sourceChanged) {
    return "The model's data source changed after write-back was set up. Re-save the output tags."
  }
  const tag =
    kind === 'PREDICTION' ? view.config?.predictionTag : view.config?.labTag
  if (!tag) {
    return `Set the ${kind === 'PREDICTION' ? 'prediction' : 'lab'} output tag first.`
  }
  if (!data) return 'Import a range first.'
  const points = pointsFor(kind, data, rows)
  if (points.length === 0) {
    return kind === 'PREDICTION'
      ? 'No scored predictions to write in this range.'
      : 'No lab values to write.'
  }
  if (points.length > WRITE_MAX_POINTS) {
    return `${points.length} points is over the ${WRITE_MAX_POINTS}-point limit for one write. Narrow the range.`
  }
  return null
}
