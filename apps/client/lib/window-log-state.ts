import type { WindowLogContext } from '@/services/inference-window'

/**
 * MODEL-SERVE-001-T10. Why a window has no log lines.
 *
 * Zero lines has FOUR causes and they send a reader to four different
 * places, so one em dash for all of them is the defect this exists to fix.
 * The taxonomy is not a guess — it follows from the container's own code:
 * `images/trainer/app/pipelines/infer.py` calls `api.claim()` and then, as
 * its very next action and BEFORE it downloads anything, logs
 * "Window claimed. ...". So a container that got as far as claiming its
 * window ALWAYS wrote at least one line. An empty log is therefore never
 * "the container ran and chose to print nothing" — it means no container
 * ever got that far, and `status` says why.
 */
export interface WindowLogEmptyState {
  title: string
  detail: string
}

export function describeEmptyWindowLog(
  window: WindowLogContext,
): WindowLogEmptyState {
  switch (window.status) {
    case 'PENDING':
      return {
        title: 'Not dispatched yet',
        detail:
          'This window is queued. The scheduler claims windows newest-first ' +
          'on its own tick, so a backfilled window can wait behind live ' +
          'ones. No container has been asked for yet, so there is nothing ' +
          'to print.',
      }
    case 'RUNNING':
      return {
        title: 'Container starting',
        detail:
          'A container has been spawned but has not reported in yet. Its ' +
          'first line arrives when it claims the window.',
      }
    case 'SKIPPED':
      return {
        title: 'Skipped — too few rows to score',
        detail:
          window.failureReason ??
          'The window held fewer rows than the configured minimum, so it ' +
            'was deliberately not attempted. A skipped window is a quiet ' +
            'plant, not a failure, and no container was spawned for it.',
      }
    case 'FAILED':
      // TWO different failures, and TM2 has both: of its 50 FAILED windows,
      // 30 never spawned a container at all and 20 spawned one that was
      // reaped (server restart) before it reached `claim` and could log.
      // One title for both would be wrong for half of them. `containerId`
      // is the discriminator — `imageDigest` is null in BOTH cases.
      return window.containerId
        ? {
            title: 'Container started but never reported in',
            detail:
              window.failureReason ??
              'A container was started for this window but produced no ' +
                'output before it stopped. Its first line would have arrived ' +
                'when it claimed the window.',
          }
        : {
            title: 'Failed before a container started',
            detail:
              window.failureReason ??
              'This window failed while preparing its input or spawning its ' +
                'container, so no container ever ran and there is nothing to ' +
                'print.',
          }
    case 'SUCCEEDED':
      // Not reachable through infer.py, which logs before it does anything
      // else and again on completion. Reaching this means something other
      // than infer.py completed the window — say so rather than inventing
      // a reassuring sentence for a state that should not exist.
      return {
        title: 'Succeeded, but reported no output',
        detail:
          'This window completed without writing any log line, which the ' +
          'inference container does not do. Treat the result with caution ' +
          'and check the window record.',
      }
  }
}

/**
 * The line the reader sees when the read cap bit. Stated on screen rather
 * than truncating silently, which is what the training-run read does.
 */
export function describeLogTruncation(
  truncated: boolean,
  omittedCount: number,
): string | null {
  if (!truncated) return null
  return `${omittedCount.toLocaleString()} earlier ${
    omittedCount === 1 ? 'line' : 'lines'
  } omitted — showing the most recent 500.`
}
