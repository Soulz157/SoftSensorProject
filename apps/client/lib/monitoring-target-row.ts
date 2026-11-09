import type {
  ColumnRangeDrift,
  InputDriftReport,
  InputDriftStatus,
} from '@/services/model-monitoring'
import { explainRangeDrift } from '@/lib/input-drift'
import type { StatusExplanation } from '@/lib/monitoring-status-explain'

/**
 * MODEL-SERVE-018. Row order for the Input Drift card: the target tag
 * (y), when the report carries one, is pinned first and flagged, followed by
 * the feature columns in the backend's own order.
 *
 * The target arrives in its own `report.target` field, never inside
 * `report.columns`, so nothing that folds `columns` into a status (the card
 * header badge, the retrain suggestion) ever sees it.
 */
export interface MonitoringRow<T> {
  row: T
  isTarget: boolean
}

export function withTargetFirst<T>(
  columns: T[],
  target: T | null | undefined,
): MonitoringRow<T>[] {
  const features = columns.map(row => ({ row, isTarget: false }))
  return target ? [{ row: target, isTarget: true }, ...features] : features
}

/**
 * The target tag's name when the model HAS a target but the report carries
 * no verdict for it: windows written before MODEL-SERVE-018, a spec with no
 * training range for it, or no Good target sample in range. The table then
 * shows a muted "not recorded" row instead of dropping the target silently,
 * so "no data yet" does not look the same as "not supported".
 */
export function unrecordedTargetColumn(
  report: Pick<InputDriftReport, 'target' | 'targetColumn'>,
): string | null {
  return report.targetColumn && !report.target ? report.targetColumn : null
}

export const TARGET_NOT_COUNTED_NOTE =
  'Shown for context only: not counted in model status or the retrain suggestion.'

// The shared input wording speaks of "this input" and of the model
// extrapolating. Neither is true of y, whose shift means the process output
// moved (label or concept shift), so the target row carries its own
// sentences.
const TARGET_MEANING: Record<InputDriftStatus, string> = {
  OK: 'Live target values stay inside the range the model was trained on.',
  WARN: 'Some live target values fall outside the training range — the process output has moved.',
  CRITICAL:
    'Many live target values fall outside the training range — the process output has moved.',
  UNKNOWN:
    'No verdict. No training range is recorded for the target, so no comparison was possible.',
  INSUFFICIENT_DATA:
    'Not enough target values yet to grade against the training range.',
}

/** Target-row tooltip: target wording, same measured criteria. */
export function explainTargetRange(
  col: ColumnRangeDrift,
  thresholds: InputDriftReport['basis']['thresholds'] | undefined,
): StatusExplanation {
  const base = col.reason
    ? `${TARGET_MEANING[col.status]} (${col.reason})`
    : TARGET_MEANING[col.status]
  return {
    meaning: `${base} ${TARGET_NOT_COUNTED_NOTE}`,
    criteria: explainRangeDrift(col, thresholds).criteria,
  }
}
