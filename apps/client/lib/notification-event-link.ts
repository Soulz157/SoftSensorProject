/**
 * MODEL-SERVE-022-T08. Pure kind -> tab mapping — "a link to models/[id]
 * opening the tab that explains it (Monitoring for health events, Retrain
 * for retrain events, Versions for promote/rollback)" (ledger's own words).
 * No I/O, no React — testable on its own.
 */
const EVENT_TAB: Record<string, string> = {
  MONITORING_ALERT: 'monitoring',
  MONITORING_WARNING: 'monitoring',
  SENSOR_FROZEN: 'monitoring',
  MONITORING_RECOVERED: 'monitoring',
  PREFLIGHT_FAILED: 'monitoring',
  MODEL_STARTED: 'monitoring',
  MODEL_STOPPED: 'monitoring',
  VERSION_PROMOTED: 'versions',
  ROLLED_BACK: 'versions',
  RETRAIN_SUCCEEDED: 'retrain',
  RETRAIN_FAILED: 'retrain',
}

/** Falls back to `input` (the page's own default tab) for an event kind
 *  this map doesn't recognise — a server that ships a new kind must still
 *  produce a working link, never a broken one. */
export function notificationEventTab(kind: string): string {
  return EVENT_TAB[kind] ?? 'input'
}

export function notificationEventHref(modelId: string, kind: string): string {
  return `/models/${modelId}?tab=${notificationEventTab(kind)}`
}
