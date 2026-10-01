'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  TooltipContent,
  TooltipTrigger,
  Tooltip,
} from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useNotifications } from '@/hooks/notifications/use-notifications'
import { formatHealthReason } from '@/lib/health-status-style'
import { NOTIFICATION_SEVERITY_CLASS } from '@/lib/notification-severity-style'
import { notificationEventHref } from '@/lib/notification-event-link'
import { notificationEventLabel } from '@/lib/notification-event-labels'
import type { NotificationEventItem } from '@/types'

/** MODEL-SERVE-022-D11: "warning -> alert (reason)", or just the level for
 *  a discrete event with no axis reading. */
function eventDetail(item: NotificationEventItem): string {
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

/**
 * MODEL-SERVE-022-D10/D11/T08. Replaces the mock notifications this
 * component used to render (T07 audit_findings) with the real event feed —
 * the SAME `NotificationEvent` rows Teams/e-mail deliveries reference,
 * never a client-side derivation from `buildAlerts`. The badge counts
 * UNREAD EVENTS ("what changed"), never current alerts — that count stays
 * on the sidebar Alerts item and the navbar status pill, both untouched.
 */
export function NavbarNotifications() {
  const { unreadCount, items, loading, loadItems, markAllRead, muteModel } =
    useNotifications()

  return (
    <DropdownMenu
      onOpenChange={open => {
        if (!open) return
        loadItems()
        markAllRead()
      }}
    >
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 cursor-pointer text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
            : 'Notifications'}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {unreadCount} new
            </Badge>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Nothing new.
            </p>
          ) : (
            items.map(item => (
              <DropdownMenuItem
                key={item.id}
                className={cn(
                  'flex flex-col items-start gap-1 p-3',
                  item.unread && 'bg-primary/5',
                )}
                asChild
              >
                <Link href={notificationEventHref(item.modelId, item.kind)}>
                  <div className="flex w-full items-start justify-between gap-2">
                    <span className="text-sm font-medium">
                      {item.modelName}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {item.unread && (
                        <span className="h-2 w-2 rounded-full bg-primary" />
                      )}
                      <button
                        type="button"
                        title="Mute this model"
                        onClick={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          muteModel(item.modelId)
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <BellOff className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                      NOTIFICATION_SEVERITY_CLASS[item.severity],
                    )}
                  >
                    {eventDetail(item)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(item.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </Link>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
