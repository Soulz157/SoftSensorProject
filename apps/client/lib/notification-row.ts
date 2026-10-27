import {
  notificationEventDetail,
  notificationToastTitle,
} from '@/lib/notification-toast'
import type { NotificationEventItem } from '@/types'

/**
 * MODEL-SERVE-039. What one bell row says, in the words the e-mail and
 * Teams alert used. The server sends the alert's own title, detail, reason
 * and timestamp (`NotificationEventItem.title` …); an event without them (an
 * older payload, an older server) falls back to the model name and the
 * shared `notificationEventDetail`, so a row is never blank. Pure — no
 * React, no clock — so every fallback is table-testable.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** "22 Oct 2026 01:29 UTC" — the format `buildNotificationMessage` writes
 *  (apps/backend/src/lib/notification-message.ts `formatTimestamp`). An
 *  unparseable value is returned as it came rather than as "NaN". */
export function formatUtcTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}

/** The alert's subject line, e.g. "Lab Quality-1 Soft Sensor: deploy failed". */
export function rowTitle(item: NotificationEventItem): string {
  return item.title ?? notificationToastTitle(item)
}

/** The one-line transition under the title. */
export function rowSummary(item: NotificationEventItem): string {
  return item.detailText ?? notificationEventDetail(item)
}

export interface RowField {
  label: string
  value: string
}

/** The label/value lines shown when a row is expanded, in the alert's
 *  order. A line the event does not carry is left out, not shown empty. */
export function rowFields(item: NotificationEventItem): RowField[] {
  const fields: RowField[] = []
  if (item.workspaceName) {
    fields.push({ label: 'Workspace', value: item.workspaceName })
  }
  fields.push({ label: 'Detail', value: rowSummary(item) })
  if (item.reasonText) fields.push({ label: 'Reason', value: item.reasonText })
  if (item.frozenText) fields.push({ label: 'Frozen', value: item.frozenText })
  return fields
}

/** When it happened, as the alert printed it. */
export function rowTimestamp(item: NotificationEventItem): string {
  return item.alertTimestamp ?? formatUtcTimestamp(item.createdAt)
}
