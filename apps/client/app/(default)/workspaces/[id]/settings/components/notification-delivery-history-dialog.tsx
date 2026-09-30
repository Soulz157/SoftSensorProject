'use client'

import { useCallback, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { usePaginatedFetch } from '@/hooks/use-paginated-fetch'
import { notificationService } from '@/services/notification'
import { NOTIFICATION_DELIVERY_STATUS_CLASS } from '@/lib/notification-severity-style'
import { notificationEventLabel } from '@/lib/notification-event-labels'
import type { NotificationChannel } from '@/types'

interface Props {
  workspaceId: string
  channel: NotificationChannel
  open: boolean
  onOpenChange: (open: boolean) => void
}

const PAGE_SIZE = 20

/** MODEL-SERVE-022-T05. "A delivery history per channel with the last
 *  error, so 'we never got the alert' is answerable" — the ledger's own
 *  acceptance criterion 6/7. Read-only: nothing here retries or edits a
 *  delivery, only shows what actually happened. */
export function NotificationDeliveryHistoryDialog({
  workspaceId,
  channel,
  open,
  onOpenChange,
}: Props) {
  const [page, setPage] = useState(1)

  const fetcher = useCallback(
    () =>
      notificationService.listDeliveries(workspaceId, channel.id, {
        page,
        limit: PAGE_SIZE,
      }),
    [workspaceId, channel.id, page],
  )
  const { data, loading, isFetching } = usePaginatedFetch(
    fetcher,
    [open, page],
    'Failed to load delivery history',
  )

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        onOpenChange(next)
        if (!next) setPage(1)
      }}
    >
      <DialogContent className="w-full sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Delivery history — {channel.name}</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border border-border overflow-hidden">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody
              className={cn(
                'transition-opacity duration-200',
                isFetching && !loading && 'opacity-60',
              )}
            >
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-xs text-muted-foreground"
                  >
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : !data || data.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-xs text-muted-foreground"
                  >
                    No deliveries yet for this channel.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map(d => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs">
                      {notificationEventLabel(d.event)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          NOTIFICATION_DELIVERY_STATUS_CLASS[d.status],
                        )}
                      >
                        {d.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{d.attempts}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(d.sentAt ?? d.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="w-full min-w-[240px] whitespace-normal break-words text-xs text-destructive">
                      {d.lastError ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
