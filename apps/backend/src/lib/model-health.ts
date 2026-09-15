import type { DriftStatus, DriftThresholds } from './prediction-drift';

/**
 * MODEL-SERVE-001-T21. The HEALTH axis — a SEPARATE signal from
 * `DeployStatus` (lib/deploy-status.ts), never collapsed into it: a model
 * can be `running` (operationally up, serving traffic) while its inputs are
 * drifting, and a model that is `stopped` has no health reading at all.
 * Mirrors deploy-status.ts's own shape — a pure classifier plus a
 * pure threshold-derivation helper, each independently testable, with the
 * actual I/O (schedule read, window pooling, baseline resolve) living in
 * the caller (`InferenceWindowMonitoringService.getHealthStatus`).
 *
 * DECIDED BY THE USER (2026-09-15): purely informational. This axis does
 * not block a promote, does not pause a schedule, and does not trigger
 * `autoRetrain` — it renders as its own badge beside `deployStatus`/
 * `prodStatus`, nothing more. `autoRetrain` stays unwired by this task,
 * exactly as this ledger item's own audit found it; wiring it up is a
 * separate, larger decision (a trigger point, a re-trigger/cooldown rule)
 * this task deliberately does not make.
 */
export type HealthStatus = 'OFF' | 'UNKNOWN' | 'OK' | 'WARN' | 'CRITICAL';

/**
 * `InferenceSchedule`'s own field names (schema.prisma, T09 Pass B) to
 * `prediction-drift.ts`'s `DriftThresholds` shape — the one place this
 * rename happens, so a caller never has to remember that `driftThresholdPct`
 * IS `outOfRangePct` under a different name chosen for the settings UI.
 */
export function thresholdsFromSchedule(schedule: {
  warnSd: number;
  criticalSd: number;
  driftThresholdPct: number;
}): DriftThresholds {
  return {
    warnSd: schedule.warnSd,
    criticalSd: schedule.criticalSd,
    outOfRangePct: schedule.driftThresholdPct,
  };
}

/**
 * `driftMonitor` gates the axis entirely — OFF is not a severity, it is
 * "not configured to look," matching this field's own documented purpose
 * (schema.prisma, T09 Pass B) rather than silently defaulting to a
 * status the operator never asked to see. `driftStatus === null` covers
 * every reason there is nothing to classify YET (no PRODUCTION version, no
 * windows with usable stats) without the caller having to distinguish
 * those reasons here — UNKNOWN is the same "nothing to report" word
 * `computeDrift` itself already uses for a column with no baseline.
 */
export function classifyModelHealth(
  driftMonitor: boolean,
  driftStatus: DriftStatus | null,
): HealthStatus {
  if (!driftMonitor) return 'OFF';
  if (driftStatus === null) return 'UNKNOWN';
  return driftStatus;
}
