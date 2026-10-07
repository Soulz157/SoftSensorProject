/**
 * MODEL-SERVE-022-T05. Client-side display labels for the event_catalogue —
 * the wire values themselves come from the server's `knownEvents`
 * (`GET .../notification-channel`), never hardcoded here as the source of
 * truth. This map only supplies a human label and default checked-state
 * for the "which events" picker; an event the server returns that this map
 * doesn't recognise still renders (falls back to the raw key), so a new
 * server-side event kind never disappears from the UI.
 */
export const NOTIFICATION_EVENT_LABEL: Record<string, string> = {
  MONITORING_ALERT: 'Monitoring: Alert',
  MONITORING_WARNING: 'Monitoring: Warning',
  SENSOR_FROZEN: 'Sensor frozen',
  MONITORING_RECOVERED: 'Monitoring: Recovered',
  PREFLIGHT_FAILED: 'Deploy failed (can’t start)',
  MODEL_STARTED: 'Model started',
  MODEL_STOPPED: 'Model stopped',
  VERSION_PROMOTED: 'Version promoted',
  ROLLED_BACK: 'Version rolled back',
  RETRAIN_SUCCEEDED: 'Retrain succeeded',
  RETRAIN_FAILED: 'Retrain failed',
  // MODEL-SERVE-031. Delivery-history only: never subscribed to directly, it
  // rides on a channel's existing monitoring events.
  MONITORING_DIGEST: 'Monitoring digest',
}

export function notificationEventLabel(event: string): string {
  return NOTIFICATION_EVENT_LABEL[event] ?? event
}

/** Events checked by default on a NEW channel — mirrors the ledger's own
 *  event_catalogue `default_on` column. */
export const DEFAULT_ON_EVENTS = [
  'MONITORING_ALERT',
  'MONITORING_WARNING',
  'SENSOR_FROZEN',
  'MONITORING_RECOVERED',
  'PREFLIGHT_FAILED',
]
