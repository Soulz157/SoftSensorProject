import { formatHealthReason } from '@/lib/health-status-style'
import { notificationEventLabel } from '@/lib/notification-event-labels'
import type { NotificationEventItem, NotificationSeverity } from '@/types'

/**
 * MODEL-SERVE-022-D11: "warning -> alert (reason)", or just the level for a
 * discrete event with no axis reading. Shared by the bell list and the
 * new-event toast so both say the same thing.
 */
export function notificationEventDetail(item: NotificationEventItem): string {
  const reason = formatHealthReason(item.reason)
  const arrow =
    item.toStatus === null
      ? null
      : item.fromStatus
        ? `${item.fromStatus} -> ${item.toStatus}`
        : item.toStatus
  if (arrow && reason) return `${arrow} (${reason})`
  return arrow ?? reason ?? notificationEventLabel(item.kind)
}

/** Only these pop a toast (user decision 2026-10-08). INFO events — started,
 *  stopped, promoted, recovered — stay bell-only so routine actions never
 *  interrupt. */
export const TOAST_SEVERITIES: readonly NotificationSeverity[] = [
  'WARNING',
  'CRITICAL',
]

/** The dedicated top-right Toaster (`components/providers/session-provider`)
 *  that new-notification toasts go to; every other toast stays bottom-center
 *  in the default Toaster. */
export const NOTIFICATION_TOASTER_ID = 'notifications'

/** At most this many toasts per poll; the rest collapse into one summary. */
export const MAX_TOASTS = 3

/** "Model A · Monitoring: Alert". */
export function notificationToastTitle(item: NotificationEventItem): string {
  return `${item.modelName} · ${notificationEventLabel(item.kind)}`
}

/**
 * The events a poll should toast: not seen before (by id — the mount-time
 * baseline and every earlier poll are in `seen`), still unread, and WARNING
 * or CRITICAL. Oldest first, so toasts stack in the order things happened.
 */
export function newToastEvents(
  items: readonly NotificationEventItem[],
  seen: ReadonlySet<string>,
): NotificationEventItem[] {
  return items
    .filter(
      i => !seen.has(i.id) && i.unread && TOAST_SEVERITIES.includes(i.severity),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
