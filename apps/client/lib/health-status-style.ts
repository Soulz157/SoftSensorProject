import type { AIModel } from '@/types'

/**
 * MODEL-SERVE-001-T30. The monitoring axis's reason codes, in the reader's
 * own terms.
 *
 * Lifted out of `models/[id]/page.tsx` when the Alerts page became a second
 * reader. A copied map is free to drift from its original the moment either
 * side adds a code — which is the defect T22 spent a whole task repairing,
 * when three client maps keyed on a renamed value and fell through a `??` to
 * green. One map, two readers.
 *
 * Only the LABELS moved. `HEALTH_CONFIG` (the badge's icon + palette) stays
 * on the detail page: it has exactly one consumer, and dragging its lucide
 * icon imports into a style module would buy nothing.
 *
 * NOTE these are DISPLAY strings over FROZEN wire values. The keys are the
 * server's own enum (apps/backend/src/lib/model-health.ts:51-58) and must
 * never be renamed to match a label.
 */
export type HealthReason = NonNullable<
  NonNullable<NonNullable<AIModel['data']>['monitoring']>['reason']
>

/**
 * Why a reason is RENDERED and never inferred from the status: the codes
 * collapse faults with OPPOSITE ACTIONS. `SOURCE_UNREACHABLE` sends a reader
 * to the connector; `STALE` sends them to the scheduler; a drift code sends
 * them to the process or to a retrain. A row that reads only "Alert" tells an
 * operator to go look at all three.
 */
export const HEALTH_REASON_LABEL: Record<HealthReason, string> = {
  SOURCE_UNREACHABLE: 'source unreachable',
  STALE: 'no recent windows',
  NO_PREDICTIONS: 'no predictions',
  BAD_DATA: 'bad input data',
  SENSOR_FROZEN: 'tag not moving',
  // T27: z-score is per-window, PSI is rolling-24. Name WHICH metric fired
  // rather than printing one merged "drift" figure that would be one metric
  // wearing another's name.
  DRIFT_CRITICAL: 'input drift (critical)',
  DRIFT_WARN: 'input drift',
  // MODEL-SERVE-012. Named for the BAND the reader already sees on the
  // Residual chart, so the badge and the chart speak the same language. Two
  // codes rather than one for the same reason the drift pair is two: 1–2 SD
  // is "watch this", beyond 3 SD is "act", and a merged label would put both
  // under one word.
  //
  // These reach the global Alerts page through `AlertRow.monitoringReason`
  // with no wiring of their own — that field is filled from
  // `monitoring.reason` and rendered through this very map, which is why the
  // map has one home and two readers.
  RESIDUAL_SD_WARN: 'residual 1–2SD',
  RESIDUAL_SD_CRITICAL: 'residual beyond 3SD',
}

/** Sentence-case, for a standalone row rather than a badge suffix. */
export function formatHealthReason(reason: string | null): string | null {
  if (!reason) return null
  const label = HEALTH_REASON_LABEL[reason as HealthReason]
  // An UNRECOGNISED code is shown verbatim rather than dropped: a server that
  // ships a new reason must not render a blank row on an older client.
  const text = label ?? reason
  return text.charAt(0).toUpperCase() + text.slice(1)
}
