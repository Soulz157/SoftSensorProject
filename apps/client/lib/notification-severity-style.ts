import type { NotificationDeliveryStatus, NotificationSeverity } from '@/types'

/**
 * MODEL-SERVE-022-T05. Reuses docs/DESIGN_SYSTEM.md §5's existing
 * red/amber/zinc status classes — no new status color mapping invented
 * (§11's own rule). CRITICAL == the "alert" row, WARNING == "warning",
 * INFO == neutral (never green: an Info event is not a claim of health).
 */
export const NOTIFICATION_SEVERITY_CLASS: Record<NotificationSeverity, string> =
  {
    CRITICAL: 'bg-red-500/15 text-red-500',
    WARNING: 'bg-amber-500/15 text-amber-500',
    INFO: 'bg-zinc-500/15 text-zinc-400',
  }

export const NOTIFICATION_SEVERITY_LABEL: Record<NotificationSeverity, string> =
  {
    CRITICAL: 'Critical',
    WARNING: 'Warning',
    INFO: 'Info',
  }

export const NOTIFICATION_DELIVERY_STATUS_CLASS: Record<
  NotificationDeliveryStatus,
  string
> = {
  SENT: 'bg-emerald-500/15 text-emerald-500',
  FAILED: 'bg-red-500/15 text-red-500',
  PENDING: 'bg-zinc-500/15 text-zinc-400',
  SENDING: 'bg-blue-500/15 text-blue-400',
}
