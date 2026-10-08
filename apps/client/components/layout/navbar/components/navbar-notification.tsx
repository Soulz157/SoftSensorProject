'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Bell, BellOff, Loader2, MoreHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { notificationEventDetail } from '@/lib/notification-toast'
import { NOTIFICATION_SEVERITY_CLASS } from '@/lib/notification-severity-style'
import { notificationEventHref } from '@/lib/notification-event-link'

/**
 * MODEL-SERVE-022-D10/D11/T08. Replaces the mock notifications this
 * component used to render (T07 audit_findings) with the real event feed —
 * the SAME `NotificationEvent` rows Teams/e-mail deliveries reference,
 * never a client-side derivation from `buildAlerts`. The badge counts
 * UNREAD EVENTS ("what changed"), never current alerts — that count stays
 * on the sidebar Alerts item and the navbar status pill, both untouched.
 */
export function NavbarNotifications() {
  const {
    unreadCount,
    items,
    loading,
    loadItems,
    markAllRead,
    dismiss,
    clearAll,
    muteModel,
  } = useNotifications()

  return (
    <DropdownMenu
      onOpenChange={open => {
        if (!open) return
        // Load first, then mark read only up to the newest event shown.
        void loadItems().then(loaded => {
          const newest = loaded?.[0]
          if (newest) void markAllRead(newest.createdAt)
        })
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
        <div className="flex items-center justify-between gap-2 pr-1">
          <DropdownMenuLabel className="flex items-center gap-2">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {unreadCount} new
              </Badge>
            )}
          </DropdownMenuLabel>
          {items.length > 0 && (
            // Hides this user's history only; nothing is muted, no toast.
            <DropdownMenuItem
              onSelect={e => {
                e.preventDefault()
                void clearAll()
              }}
              className="cursor-pointer h-7 px-2 text-xs text-muted-foreground"
            >
              Clear all
            </DropdownMenuItem>
          )}
        </div>
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
              // The row is three menu items side by side — the link, Remove
              // and More — never a button nested inside the link (invalid
              // HTML, and unreachable by keyboard in a menu).
              <div
                key={item.id}
                className={cn(
                  'flex items-start gap-0.5 rounded-md',
                  item.unread && 'bg-primary/5',
                )}
              >
                <DropdownMenuItem
                  className="flex min-w-0 flex-1 flex-col items-start gap-1 p-3"
                  asChild
                >
                  <Link href={notificationEventHref(item.modelId, item.kind)}>
                    <span className="flex w-full items-center gap-1.5">
                      <span className="truncate text-sm font-medium">
                        {item.modelName}
                      </span>
                      {item.unread && (
                        <span
                          className="size-2 shrink-0 rounded-full bg-primary"
                          aria-label="unread"
                        />
                      )}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                        NOTIFICATION_SEVERITY_CLASS[item.severity],
                      )}
                    >
                      {notificationEventDetail(item)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(item.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </Link>
                </DropdownMenuItem>
                <div className="flex shrink-0 items-center pt-2 pr-1">
                  <DropdownMenuItem
                    aria-label={`Remove ${item.modelName} notification`}
                    title="Remove"
                    // Keep the menu open: removing is housekeeping.
                    onSelect={e => {
                      e.preventDefault()
                      void dismiss(item)
                    }}
                    className="cursor-pointer size-7 justify-center p-0 text-muted-foreground"
                  >
                    <X className="size-3.5" />
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    {/* The shadcn sub-trigger always appends a chevron;
                        hidden here, the ⋯ already says "more". */}
                    <DropdownMenuSubTrigger
                      aria-label={`More actions for ${item.modelName}`}
                      title="More"
                      className="cursor-pointer size-7 justify-center p-0 text-muted-foreground [&>svg:last-child]:hidden"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem
                        onSelect={() => void muteModel(item.modelId)}
                      >
                        <BellOff />
                        Mute this model
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </div>
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
