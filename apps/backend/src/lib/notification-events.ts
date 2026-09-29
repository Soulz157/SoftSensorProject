/**
 * MODEL-SERVE-022. The event_catalogue from the ledger, as a single runtime
 * array — used to validate `NotificationChannel.events` at write time (DTO)
 * and to default a NEW channel's subscriptions (T05, not built this pass).
 * Kept as a plain string union rather than a Prisma enum (D07's own schema
 * comment): the catalogue is expected to grow, and a migration per new
 * event kind is exactly the friction a string column avoids.
 */
export const NOTIFICATION_EVENT_KINDS = [
  'MONITORING_ALERT',
  'MONITORING_WARNING',
  'SENSOR_FROZEN',
  'MONITORING_RECOVERED',
  'PREFLIGHT_FAILED',
  'MODEL_STARTED',
  'MODEL_STOPPED',
  'VERSION_PROMOTED',
  'ROLLED_BACK',
  'RETRAIN_SUCCEEDED',
  'RETRAIN_FAILED',
] as const;

export type NotificationEventKind = (typeof NOTIFICATION_EVENT_KINDS)[number];

/** default_on from the ledger's own event_catalogue — what a NEW channel
 *  subscribes to before the user changes anything. */
export const DEFAULT_ON_EVENT_KINDS: NotificationEventKind[] = [
  'MONITORING_ALERT',
  'MONITORING_WARNING',
  'SENSOR_FROZEN',
  'MONITORING_RECOVERED',
  'PREFLIGHT_FAILED',
];
