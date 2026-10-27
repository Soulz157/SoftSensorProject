'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowRight,
  BellOff,
  ChevronDown,
  MoreHorizontal,
  X,
} from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  NOTIFICATION_SEVERITY_CLASS,
  NOTIFICATION_SEVERITY_LABEL,
} from '@/lib/notification-severity-style'
import { notificationEventHref } from '@/lib/notification-event-link'
import {
  rowFields,
  rowSummary,
  rowTimestamp,
  rowTitle,
} from '@/lib/notification-row'
import type { NotificationEventItem } from '@/types'

interface Props {
  item: NotificationEventItem
  onDismiss: (item: NotificationEventItem) => void
  onMute: (modelId: string) => void
}

/**
 * MODEL-SERVE-039. One bell row, in the alert's format. Collapsed it is a
 * feed line — the alert's title, a severity chip, and "detail · time ago".
 * Opening it shows the rest of what the e-mail / Teams alert said:
 * Workspace, Detail, Reason, the UTC timestamp, and Open model.
 *
 * Built from menu items side by side — the toggle, Remove, More, and the
 * Open model link — never a button nested in the link (invalid HTML, and
 * unreachable by keyboard in a menu). The toggle keeps the menu open, like
 * Remove does, so reading a row never closes the bell.
 */
export function NotificationRow({ item, onDismiss, onMute }: Props) {
  const [expanded, setExpanded] = useState(false)
  const panelId = `notification-${item.id}`
  const title = rowTitle(item)
  const relative = formatDistanceToNow(new Date(item.createdAt), {
    addSuffix: true,
  })

  return (
    <div className="border-b border-border/60 last:border-b-0">
      <div
        className={cn(
          'flex items-start gap-0.5 rounded-md',
          item.unread && 'bg-primary/5',
        )}
      >
        <div className="min-w-0 flex-1">
          <DropdownMenuItem
            aria-expanded={expanded}
            aria-controls={expanded ? panelId : undefined}
            onSelect={e => {
              e.preventDefault()
              setExpanded(open => !open)
            }}
            className="flex w-full min-w-0 cursor-pointer flex-col items-start gap-1 p-3"
          >
            <span className="flex w-full items-start gap-1.5">
              {item.unread && (
                <span
                  className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                  aria-label="unread"
                />
              )}
              <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium">
                {title}
              </span>
              <span
                className={cn(
                  'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                  NOTIFICATION_SEVERITY_CLASS[item.severity],
                )}
              >
                {NOTIFICATION_SEVERITY_LABEL[item.severity]}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform',
                  expanded && 'rotate-180',
                )}
              />
            </span>
            {!expanded && (
              <span className="flex w-full min-w-0 items-baseline gap-1 text-xs text-muted-foreground">
                <span className="truncate">{rowSummary(item)}</span>
                <span className="shrink-0">· {relative}</span>
              </span>
            )}
          </DropdownMenuItem>

          {expanded && (
            <div id={panelId} className="space-y-2 px-3 pb-3 text-xs">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                {rowFields(item).map(field => (
                  <div key={field.label} className="contents">
                    <dt className="text-muted-foreground">{field.label}</dt>
                    <dd
                      title={field.value}
                      className={cn(
                        'min-w-0 break-words',
                        field.label === 'Reason' && 'line-clamp-2',
                      )}
                    >
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-muted-foreground">
                {rowTimestamp(item)} · {relative}
              </p>
              <DropdownMenuItem
                asChild
                className="w-fit cursor-pointer gap-1 px-2 py-1 text-xs font-medium text-primary"
              >
                <Link href={notificationEventHref(item.modelId, item.kind)}>
                  Open model
                  <ArrowRight className="size-3.5" />
                </Link>
              </DropdownMenuItem>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center pt-2 pr-1">
          <DropdownMenuItem
            aria-label={`Remove ${item.modelName} notification`}
            title="Remove"
            // Keep the menu open: removing is housekeeping.
            onSelect={e => {
              e.preventDefault()
              onDismiss(item)
            }}
            className="size-7 cursor-pointer justify-center p-0 text-muted-foreground"
          >
            <X className="size-3.5" />
          </DropdownMenuItem>
          <DropdownMenuSub>
            {/* The shadcn sub-trigger always appends a chevron; hidden here,
                the ⋯ already says "more". */}
            <DropdownMenuSubTrigger
              aria-label={`More actions for ${item.modelName}`}
              title="More"
              className="size-7 cursor-pointer justify-center p-0 text-muted-foreground [&>svg:last-child]:hidden"
            >
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => onMute(item.modelId)}>
                <BellOff />
                Mute this model
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </div>
      </div>
    </div>
  )
}
