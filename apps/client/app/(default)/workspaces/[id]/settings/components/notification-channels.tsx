'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import {
  AlertTriangle,
  Bell,
  History,
  Loader2,
  Mail,
  MoreHorizontal,
  Plus,
  Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { notificationService } from '@/services/notification'
import { useNotificationChannels } from '@/hooks/notification/use-notification-channels'
import { useWorkspaceMembers } from '@/hooks/workspace/use-workspace-members'
import { useWorkspaceModels } from '@/hooks/workspace/use-workspace-models'
import { NOTIFICATION_SEVERITY_CLASS } from '@/lib/notification-severity-style'
import { NotificationChannelFormDialog } from './notification-channel-form-dialog'
import { NotificationDeliveryHistoryDialog } from './notification-delivery-history-dialog'
import type { NotificationChannel } from '@/types'

interface Props {
  workspaceId: string
}

function ChannelsSkeleton() {
  return (
    <>
      {[0, 1].map(i => (
        <TableRow key={i}>
          <TableCell>
            <Skeleton className="h-4 w-40" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-16 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-7 w-7 rounded-md" />
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

/**
 * MODEL-SERVE-022-T05. Minimal settings UI for MODEL-SERVE-022's channel
 * API (T04). OWNER-only for every mutating action, matching the server's
 * own `assertIsOwner` gate (D-user-decision).
 */
export function NotificationChannels({ workspaceId }: Props) {
  const { data: session } = useSession()
  const currentUserId = session?.user?.id

  const { channels, knownEvents, loading, isFetching, fetchChannels } =
    useNotificationChannels(workspaceId)
  const { members, isOwner } = useWorkspaceMembers(workspaceId, currentUserId)
  const { models } = useWorkspaceModels(workspaceId)

  const [formOpen, setFormOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<
    NotificationChannel | undefined
  >(undefined)
  const [historyChannel, setHistoryChannel] =
    useState<NotificationChannel | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function openCreate() {
    setEditingChannel(undefined)
    setFormOpen(true)
  }

  function openEdit(channel: NotificationChannel) {
    setEditingChannel(channel)
    setFormOpen(true)
  }

  async function handleTest(channel: NotificationChannel) {
    setTestingId(channel.id)
    try {
      const res = await notificationService.testChannel(workspaceId, channel.id)
      if (res.data.status === 'SENT') {
        toast.success('Test notification sent')
      } else {
        toast.error(res.data.lastError ?? 'Test notification failed')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Test send failed')
    } finally {
      setTestingId(null)
    }
  }

  async function handleDelete(channel: NotificationChannel) {
    setDeletingId(channel.id)
    try {
      await notificationService.deleteChannel(workspaceId, channel.id)
      toast.success('Channel deleted')
      await fetchChannels()
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete channel',
      )
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">
            Notification channels
          </h3>
          {!loading && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground font-medium">
              {channels.length}
            </span>
          )}
        </div>
        {isOwner && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 text-xs"
            onClick={openCreate}
          >
            <Plus className="h-3.5 w-3.5" />
            Add channel
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Send a Microsoft Teams Workflow message or e-mail when a model&apos;s
        deploy or monitoring state changes, or on a promote, rollback, or
        retrain.
      </p>

      <Alert className="border-border bg-muted/30">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="text-sm">
          Some alerts can&apos;t fire on every model yet
        </AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground space-y-1">
          <p>
            This is expected, not a broken notifier — each depends on data this
            deployment may not have yet:
          </p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>
              Residual-SD alerts need at least 30 joined truth pairs for a
              model.
            </li>
            <li>
              Input-drift and distribution alerts only fire when a schedule has
              Drift Monitor enabled.
            </li>
            <li>
              Input-distribution (PSI) alerts also need a frozen reference from
              the model&apos;s training run.
            </li>
          </ul>
        </AlertDescription>
      </Alert>

      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>Min. severity</TableHead>
              <TableHead>Events</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody
            className={cn(
              'transition-opacity duration-200',
              isFetching && !loading && 'opacity-60',
            )}
          >
            {loading ? (
              <ChannelsSkeleton />
            ) : channels.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-6 text-center text-xs text-muted-foreground"
                >
                  No notification channels yet.
                </TableCell>
              </TableRow>
            ) : (
              channels.map(channel => {
                const isTesting = testingId === channel.id
                const isDeleting = deletingId === channel.id
                return (
                  <TableRow key={channel.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {channel.kind === 'TEAMS_WORKFLOW' ? (
                          <Bell className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {channel.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {channel.kind === 'TEAMS_WORKFLOW'
                              ? channel.hasTarget
                                ? 'Teams Workflow configured'
                                : 'No Workflow URL set'
                              : `${channel.recipientUserIds.length} recipient${channel.recipientUserIds.length === 1 ? '' : 's'}`}
                            {!channel.enabled && ' · disabled'}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          NOTIFICATION_SEVERITY_CLASS[channel.minSeverity],
                        )}
                      >
                        {channel.minSeverity}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {channel.events.length}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={isTesting || isDeleting}
                          >
                            {isTesting || isDeleting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-full">
                          {/* Owner-only, like Edit/Delete: the server
                              refuses a test send from staff, who may only
                              VIEW channels and delivery history. */}
                          {isOwner && (
                            <DropdownMenuItem
                              onClick={() => handleTest(channel)}
                              className="cursor-pointer"
                            >
                              <Send className="h-3.5 w-3.5" />
                              Send test notification
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => setHistoryChannel(channel)}
                            className="cursor-pointer"
                          >
                            <History className="h-3.5 w-3.5" />
                            Delivery history
                          </DropdownMenuItem>
                          {isOwner && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => openEdit(channel)}
                                className="cursor-pointer"
                              >
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive cursor-pointer"
                                onClick={() => handleDelete(channel)}
                              >
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {isOwner && (
        <NotificationChannelFormDialog
          workspaceId={workspaceId}
          channel={editingChannel}
          knownEvents={knownEvents}
          members={members}
          models={models ?? []}
          open={formOpen}
          onOpenChange={setFormOpen}
          onSaved={fetchChannels}
        />
      )}

      {historyChannel && (
        <NotificationDeliveryHistoryDialog
          workspaceId={workspaceId}
          channel={historyChannel}
          open={!!historyChannel}
          onOpenChange={next => !next && setHistoryChannel(null)}
        />
      )}
    </div>
  )
}
