import type {
  DriftColumn,
  DriftReport,
  DriftStatus,
  PsiColumn,
  PsiReport,
  PsiStatus,
} from '@/services/model-monitoring'
import {
  explainDriftColumn,
  explainPsiColumn,
  type StatusExplanation,
} from '@/lib/monitoring-status-explain'

/**
 * MODEL-SERVE-018. Row order for the drift and PSI tables: the target tag
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
 * PSI reference for it, or no Good target sample in range. The table then
 * shows a muted "not recorded" row instead of dropping the target silently,
 * so "no data yet" does not look the same as "not supported".
 */
export function unrecordedTargetColumn(
  report: Pick<DriftReport | PsiReport, 'target' | 'targetColumn'>,
): string | null {
  return report.targetColumn && !report.target ? report.targetColumn : null
}

export const TARGET_NOT_COUNTED_NOTE =
  'Shown for context only: not counted in model status or the retrain suggestion.'

// The shared drift/PSI wording speaks of "this input" and of the model
// predicting on unfamiliar data. Neither is true of y, whose shift means the
// process output moved (label or concept shift), so the target row carries
// its own sentences.
const TARGET_DRIFT_MEANING: Record<DriftStatus, string> = {
  OK: 'The target’s live mean is still close to its training mean.',
  WARN: 'The target’s live mean has moved away from its training mean: the process output is running at a different level than the model learned.',
  CRITICAL:
    'The target’s live mean has moved far from its training mean: the process output is running well outside the range the model learned.',
  UNKNOWN:
    'No verdict. The target’s training baseline is missing or degenerate, so no comparison was possible.',
}

const TARGET_PSI_MEANING: Record<PsiStatus, string> = {
  OK: 'The target’s live distribution still overlaps its frozen training bins.',
  WARN: 'The target’s live distribution has shifted noticeably against its training bins.',
  CRITICAL:
    'The target’s live distribution barely resembles the one the model trained on.',
  UNKNOWN:
    'No verdict. No training reference exists for the target, so no comparison was possible.',
  INSUFFICIENT_DATA:
    'Not enough target samples yet. A training reference exists; PSI is not computed below its sample floor.',
}

function withReason(meaning: string, reason: string | undefined): string {
  const base = reason ? `${meaning} (${reason})` : meaning
  return `${base} ${TARGET_NOT_COUNTED_NOTE}`
}

/** Target-row drift tooltip: target wording, same measured criteria. */
export function explainTargetDrift(
  col: Pick<DriftColumn, 'z' | 'status' | 'reason'>,
  thresholds: DriftReport['basis']['thresholds'],
): StatusExplanation {
  return {
    meaning: withReason(TARGET_DRIFT_MEANING[col.status], col.reason),
    criteria: explainDriftColumn(col, thresholds).criteria,
  }
}

/** Target-row PSI tooltip: target wording, same measured criteria. */
export function explainTargetPsi(
  col: Pick<PsiColumn, 'psi' | 'status' | 'reason' | 'liveTotal' | 'bins'>,
  thresholds: PsiReport['basis']['thresholds'],
): StatusExplanation {
  return {
    meaning: withReason(TARGET_PSI_MEANING[col.status], col.reason),
    criteria: explainPsiColumn(col, thresholds).criteria,
  }
}
