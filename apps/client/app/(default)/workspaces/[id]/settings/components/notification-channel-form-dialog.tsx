'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { notificationService } from '@/services/notification'
import { FocusModelSelect } from './focus-model-select'
import { notificationEventLabel } from '@/lib/notification-event-labels'
import type {
  NotificationChannel,
  NotificationChannelKind,
  NotificationSeverity,
  WorkspaceMember,
  WorkspaceModel,
} from '@/types'

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

interface Props {
  workspaceId: string
  /** Undefined = create. Present = edit (kind is then fixed). */
  channel?: NotificationChannel
  knownEvents: string[]
  members: WorkspaceMember[]
  models: WorkspaceModel[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

/**
 * MODEL-SERVE-022-T05. Only the Dialog shell — the form body below is
 * mounted (and unmounted) with `open`, so a fresh channel or a fresh
 * "create" draft always starts from its OWN initial `useState`, never from
 * an effect syncing props into state after the fact (react-hooks/set-state-
 * in-effect: that shape cascades a render on every open and risks a stale
 * draft leaking into a different channel's edit if the effect's deps ever
 * missed one).
 */
export function NotificationChannelFormDialog(props: Props) {
  const { open, onOpenChange } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        {open && (
          <NotificationChannelForm
            key={props.channel?.id ?? 'create'}
            {...props}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function NotificationChannelForm({
  workspaceId,
  channel,
  knownEvents,
  members,
  models,
  onOpenChange,
  onSaved,
}: Props) {
  const isEdit = !!channel

  const [kind, setKind] = useState<NotificationChannelKind>(
    channel?.kind ?? 'TEAMS_WORKFLOW',
  )
  const [name, setName] = useState(channel?.name ?? '')
  const [target, setTarget] = useState('')
  const [recipientUserIds, setRecipientUserIds] = useState<string[]>(
    channel?.recipientUserIds ?? [],
  )
  const [minSeverity, setMinSeverity] = useState<NotificationSeverity>(
    channel?.minSeverity ?? 'WARNING',
  )
  const [events, setEvents] = useState<string[]>(channel?.events ?? knownEvents)
  const [cooldownMinutes, setCooldownMinutes] = useState(
    channel?.cooldownMinutes ?? 0,
  )
  // MODEL-SERVE-022-D-FOCUS. A new channel starts on every model; an edited
  // one keeps exactly what it had.
  const [focusModelIds, setFocusModelIds] = useState<string[]>(
    channel?.focusModelIds ?? models.map(m => m.id),
  )
  const [saving, setSaving] = useState(false)

  function toggle(list: string[], id: string, set: (v: string[]) => void) {
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (kind === 'TEAMS_WORKFLOW' && !isEdit && !target.trim()) {
      toast.error('The Teams Workflow URL is required')
      return
    }
    if (kind === 'EMAIL' && recipientUserIds.length === 0) {
      toast.error('Select at least one recipient')
      return
    }
    if (focusModelIds.length === 0) {
      toast.error('Select at least one model, or Select all')
      return
    }
    setSaving(true)
    try {
      if (isEdit) {
        await notificationService.updateChannel(workspaceId, channel.id, {
          name: name.trim(),
          ...(target.trim() ? { target: target.trim() } : {}),
          recipientUserIds,
          minSeverity,
          events,
          cooldownMinutes,
          focusModelIds,
        })
        toast.success('Channel updated')
      } else {
        await notificationService.createChannel(workspaceId, {
          kind,
          name: name.trim(),
          target: kind === 'TEAMS_WORKFLOW' ? target.trim() : undefined,
          recipientUserIds: kind === 'EMAIL' ? recipientUserIds : undefined,
          minSeverity,
          events,
          cooldownMinutes,
          focusModelIds,
        })
        toast.success('Channel created')
      }
      onOpenChange(false)
      onSaved()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save channel')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? 'Edit notification channel' : 'Add notification channel'}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Update where and when this channel notifies.'
            : 'Choose Teams Workflow or e-mail, and which events it should receive.'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {!isEdit && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Kind</label>
            <select
              className={selectClass}
              value={kind}
              onChange={e => setKind(e.target.value as NotificationChannelKind)}
              disabled={saving}
            >
              <option value="TEAMS_WORKFLOW">Microsoft Teams Workflow</option>
              <option value="EMAIL">E-mail</option>
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Name</label>
          <input
            className={inputClass}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Plant floor Teams channel"
            disabled={saving}
          />
        </div>

        {kind === 'TEAMS_WORKFLOW' && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Teams Workflow URL
            </label>
            <input
              className={inputClass}
              type="url"
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder={
                isEdit && channel?.hasTarget
                  ? 'https://••• (leave blank to keep the current URL)'
                  : 'https://…/workflows/…'
              }
              disabled={saving}
            />
            <p className="text-[11px] text-muted-foreground">
              The stored URL is never shown again after saving — paste it here
              only to set or replace it.
            </p>
          </div>
        )}

        {kind === 'EMAIL' && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Recipients (workspace members)
            </label>
            <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {members.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No members in this workspace yet.
                </p>
              ) : (
                members.map(m => (
                  <label
                    key={m.userId}
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={recipientUserIds.includes(m.userId)}
                      onChange={() =>
                        toggle(recipientUserIds, m.userId, setRecipientUserIds)
                      }
                      disabled={saving}
                    />
                    {[m.user.firstName, m.user.lastName]
                      .filter(Boolean)
                      .join(' ') || m.user.email}
                    <span className="text-xs text-muted-foreground">
                      ({m.user.email})
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">
            Minimum severity
          </label>
          <select
            className={selectClass}
            value={minSeverity}
            onChange={e =>
              setMinSeverity(e.target.value as NotificationSeverity)
            }
            disabled={saving}
          >
            <option value="INFO">Info and above</option>
            <option value="WARNING">Warning and above</option>
            <option value="CRITICAL">Critical only</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Events</label>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {knownEvents.map(event => (
              <label
                key={event}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <input
                  type="checkbox"
                  checked={events.includes(event)}
                  onChange={() => toggle(events, event, setEvents)}
                  disabled={saving}
                />
                {notificationEventLabel(event)}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">
            Cooldown (minutes)
          </label>
          <input
            className={inputClass}
            type="number"
            min={0}
            max={1440}
            value={cooldownMinutes}
            onChange={e => setCooldownMinutes(Number(e.target.value) || 0)}
            disabled={saving}
          />
          <p className="text-[11px] text-muted-foreground">
            Not yet enforced by the server — reserved for a future pass
            (flapping suppression is an open decision).
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">
            Focus models
          </label>
          <FocusModelSelect
            models={models}
            selected={focusModelIds}
            onChange={setFocusModelIds}
            disabled={saving}
          />
          <p
            className={
              focusModelIds.length === 0
                ? 'text-[11px] text-destructive'
                : 'text-[11px] text-muted-foreground'
            }
          >
            {focusModelIds.length === 0
              ? 'Select at least one model — this channel sends nothing for unselected models.'
              : 'Only these models trigger this channel. A model added later must be selected here.'}
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || focusModelIds.length === 0}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          {isEdit ? 'Save changes' : 'Add channel'}
        </Button>
      </DialogFooter>
    </>
  )
}
