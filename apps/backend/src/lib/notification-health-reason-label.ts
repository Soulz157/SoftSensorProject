import type { HealthReason } from './model-health';

/**
 * MODEL-SERVE-022-D09. A SERVER-SIDE PIN of
 * `apps/client/lib/health-status-style.ts`'s `HEALTH_REASON_LABEL` — same
 * reasoning as `notification-monitoring-status.ts`'s own doc comment.
 *
 * KEEP THIS IN SYNC WITH apps/client/lib/health-status-style.ts. The keys
 * are the server's OWN enum (`lib/model-health.ts`'s `HealthReason`), so a
 * reason this map does not recognise is a compile error here, not a silent
 * blank — the client's own `formatHealthReason` falls back to the raw code
 * for an unrecognised value because IT can ship behind the server; this
 * file has no such excuse, since it is built from the same `HealthReason`
 * union it labels.
 */
export const HEALTH_REASON_LABEL: Record<HealthReason, string> = {
  SOURCE_UNREACHABLE: 'source unreachable',
  STALE: 'no recent windows',
  NO_PREDICTIONS: 'no predictions',
  BAD_DATA: 'bad input data',
  SENSOR_FROZEN: 'tag not moving',
  DRIFT_CRITICAL: 'input drift (critical)',
  DRIFT_WARN: 'input drift',
  DRIFT_DIST_CRITICAL: 'input distribution shifted',
  RESIDUAL_SD_WARN: 'residual 1–2SD',
  RESIDUAL_SD_CRITICAL: 'residual beyond 3SD',
};

/** Sentence-case, matching the client's own `formatHealthReason` shape. */
export function formatHealthReason(reason: HealthReason | null): string | null {
  if (!reason) return null;
  const text = HEALTH_REASON_LABEL[reason];
  return text.charAt(0).toUpperCase() + text.slice(1);
}
