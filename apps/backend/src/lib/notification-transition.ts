import type { HealthReason, HealthStatus } from './model-health';

/**
 * MODEL-SERVE-022-D01/D03. Pure transition logic for the MONITORING axis —
 * no I/O, no Prisma, so it is testable without a database (V01). The
 * caller (`NotificationEvaluatorService`) supplies the PREVIOUS notified
 * state (a `ModelAlertState` row, or `null` when none exists yet) and the
 * CURRENT verdict from `getHealthStatus`, and gets back whether the state
 * changed and, if so, which event (if any) to enqueue.
 */

export type MonitoringSnapshot = {
  status: HealthStatus;
  reason: HealthReason | null;
  frozenColumns: string[];
};

export type MonitoringEventKind =
  | 'MONITORING_ALERT'
  | 'MONITORING_WARNING'
  | 'SENSOR_FROZEN'
  | 'MONITORING_RECOVERED';

export type NotifySeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface MonitoringTransitionResult {
  /** True when `ModelAlertState` must be written (state truly differs from
   *  what is stored, including a frozen-columns-only change) — the caller
   *  upserts unconditionally when `notify` is set, but should skip a
   *  needless write when neither changed AND notify is null. */
  changed: boolean;
  notify: { event: MonitoringEventKind; severity: NotifySeverity } | null;
}

function sameFrozenColumns(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((c, i) => c === sortedB[i]);
}

/** The event a given CURRENT status implies, independent of what it came
 *  from — OFF/UNKNOWN never raise anything (D03: "no evidence is not a
 *  claim either way"), and OK is handled by the caller since "recovered"
 *  depends on what the PREVIOUS status was, not just the new one. */
function eventForEnteredStatus(
  status: HealthStatus,
): { event: MonitoringEventKind; severity: NotifySeverity } | null {
  switch (status) {
    case 'ALERT':
    case 'CRITICAL':
      return { event: 'MONITORING_ALERT', severity: 'CRITICAL' };
    case 'WARN':
      return { event: 'MONITORING_WARNING', severity: 'WARNING' };
    case 'FROZEN':
      return { event: 'SENSOR_FROZEN', severity: 'WARNING' };
    default:
      return null;
  }
}

const ALARMED: ReadonlySet<HealthStatus> = new Set([
  'WARN',
  'ALERT',
  'CRITICAL',
  'FROZEN',
]);

/**
 * D01: notify on transitions of (status, reason), never on levels. D03:
 * the FIRST evaluation of a model (no prior row at all) only records a
 * baseline and sends nothing — including when that baseline is already
 * ALERT/WARN/FROZEN. This is the decision literally as D03 states it
 * ("the first evaluation of a model only records state and sends
 * nothing"), not a per-status carve-out: shipping this feature must not
 * fire a burst of alerts for every model that was already alarming the
 * moment the sweep first runs. A model that transitions again LATER, from
 * that recorded baseline, is notified normally.
 */
export function evaluateMonitoringTransition(
  prev: MonitoringSnapshot | null,
  next: MonitoringSnapshot,
): MonitoringTransitionResult {
  if (prev === null) {
    return { changed: true, notify: null };
  }

  const sameStatus = prev.status === next.status;
  const sameReason = prev.reason === next.reason;

  if (sameStatus && sameReason) {
    // FROZEN is the one status whose OWN payload (which columns) can change
    // without status/reason moving — D01: "only newly added columns are a
    // transition; a column that stays frozen sends nothing further."
    if (next.status === 'FROZEN') {
      const newColumns = next.frozenColumns.filter(
        (c) => !prev.frozenColumns.includes(c),
      );
      if (newColumns.length > 0) {
        return {
          changed: true,
          notify: { event: 'SENSOR_FROZEN', severity: 'WARNING' },
        };
      }
    }
    const columnsChanged = !sameFrozenColumns(
      prev.frozenColumns,
      next.frozenColumns,
    );
    return { changed: columnsChanged, notify: null };
  }

  // Status or reason moved. `next.status === 'OK'` is decided against what
  // the PREVIOUS status was — D03: recovery is a claim about having been
  // measured bad and now being measured fine, never about having had no
  // claim at all (OFF/UNKNOWN) and now having one.
  if (next.status === 'OK') {
    if (ALARMED.has(prev.status)) {
      return {
        changed: true,
        notify: { event: 'MONITORING_RECOVERED', severity: 'INFO' },
      };
    }
    return { changed: true, notify: null };
  }

  return { changed: true, notify: eventForEnteredStatus(next.status) };
}
