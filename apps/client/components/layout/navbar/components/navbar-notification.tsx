'use client'

import { Bell, Loader2 } from 'lucide-react'
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
import { useNotifications } from '@/hooks/notifications/use-notifications'
import { NotificationRow } from './notification-row'

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

      <DropdownMenuContent align="end" className="w-96">
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
        <div className="max-h-[28rem] overflow-y-auto">
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
              <NotificationRow
                key={item.id}
                item={item}
                onDismiss={target => void dismiss(target)}
                onMute={modelId => void muteModel(modelId)}
              />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
