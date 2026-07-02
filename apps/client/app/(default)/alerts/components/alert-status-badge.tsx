'use client'

import { cn } from '@/lib/utils'
import {
  ALERT_STATUS_BADGE,
  ALERT_STATUS_DOT,
  ALERT_STATUS_LABEL,
  ALERT_STATUS_PULSE,
  type AlertStatus,
} from '@/lib/alerts'

export function AlertStatusBadge({
  status,
  className,
}: {
  status: AlertStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-muted/40 px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        ALERT_STATUS_BADGE[status],
        className,
      )}
    >
      <span
        className={cn(
          'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
          ALERT_STATUS_DOT[status],
          ALERT_STATUS_PULSE[status] && 'animate-pulse ring-2 ring-current/30',
        )}
      />
      {ALERT_STATUS_LABEL[status]}
    </span>
  )
}
