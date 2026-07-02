'use client'

import { cn } from '@/lib/utils'
import {
  ALERT_STATUS_BADGE,
  ALERT_STATUS_LABEL,
  type AlertCounts,
  type AlertStatus,
} from '@/lib/alerts'

const ORDER: AlertStatus[] = ['failed', 'alarm', 'warning', 'offline']

export function AlertsSummary({ counts }: { counts: AlertCounts }) {
  const items = ORDER.filter(s => counts[s] > 0)
  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map(status => (
        <span
          key={status}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full bg-muted/40 px-2.5 py-1 text-xs font-medium',
            ALERT_STATUS_BADGE[status],
          )}
        >
          <span className="font-semibold tabular-nums">{counts[status]}</span>
          {ALERT_STATUS_LABEL[status]}
        </span>
      ))}
    </div>
  )
}
