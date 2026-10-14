import { formatWallClockFull } from '@/lib/monitoring'
import { utcToWallMs } from '@/lib/evaluation-compare'
import type {
  RollbackDryRun,
  WriteBackBatchSummary,
  WriteBackStatus,
} from '@/services/model-evaluation'

/**
 * MODEL-SERVE-032. Pure rules for the write-history table and the rollback
 * dialog: wording, who may roll what back, and what a dry run allows.
 * The server decides every one of these again on the real call.
 */

export const STATUS_LABEL: Record<WriteBackStatus, string> = {
  PENDING: 'Pending',
  WRITING: 'Writing',
  SUCCEEDED: 'Succeeded',
  PARTIAL: 'Partly written',
  FAILED: 'Failed',
  ROLLED_BACK: 'Rolled back',
}

export const KIND_LABEL: Record<WriteBackBatchSummary['kind'], string> = {
  PREDICTION: 'Predictions',
  LAB: 'Lab values',
  ROLLBACK: 'Rollback',
}

/** A UTC instant as plant (UTC+7) wall clock, e.g. "Oct 14, 2026 08:00". */
export function formatPlantTime(iso: string): string {
  return formatWallClockFull(utcToWallMs(iso))
}

/** "from – to" in plant time. */
export function formatRange(from: string, to: string): string {
  return `${formatPlantTime(from)} – ${formatPlantTime(to)}`
}

/**
 * Why this batch cannot be rolled back right now, in words; null when it can.
 * A batch whose points were never snapshotted (refused before PI changed)
 * has no ok or failed count, and has nothing to restore.
 */
export function rollbackBlocker(
  batch: Pick<
    WriteBackBatchSummary,
    'kind' | 'status' | 'okCount' | 'failedCount'
  >,
  canWrite: boolean,
): string | null {
  if (!canWrite) {
    return 'Only the workspace owner or an admin can roll back a write.'
  }
  if (batch.kind === 'ROLLBACK') {
    return 'A rollback cannot be rolled back. Write the values again instead.'
  }
  if (batch.status === 'ROLLED_BACK') return 'Already rolled back.'
  if (batch.status === 'PENDING' || batch.status === 'WRITING') {
    return 'Still being written.'
  }
  if (batch.okCount + batch.failedCount === 0) {
    return 'Nothing to roll back: no values were recorded for this write.'
  }
  return null
}

/** A stored value for a table cell. Absent is "none", never 0. */
export function formatStored(
  value: number | null | undefined,
  existed = true,
): string {
  if (!existed || value === null || value === undefined) return 'none'
  return String(value)
}

/** How a drifted point's current value reads. */
export function formatDriftActual(actual: number | string): string {
  if (typeof actual === 'number') return String(actual)
  return actual === 'none' ? 'none' : 'a system state'
}

/**
 * Whether the real rollback would go ahead given the box the user ticked.
 * A later overlapping write never goes ahead; drift needs the tick.
 */
export function canRollbackNow(plan: RollbackDryRun, force: boolean): boolean {
  if (plan.blockedBy) return false
  return plan.driftCount === 0 || (plan.canForce && force)
}
