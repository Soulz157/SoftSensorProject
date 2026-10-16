'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Gauge, Info, Loader2 } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { workspaceService } from '@/services/workspace'
import {
  overLimitNote,
  parseLimitInput,
  type LimitKind,
} from '@/lib/workspace-limits'

export interface WorkspaceLimitValues {
  maxModels: number | null
  maxMembers: number | null
}

interface AdminLimitsCardProps {
  workspaceId: string
  limits: WorkspaceLimitValues
  usage: { models: number; members: number }
  onSaved: (limits: WorkspaceLimitValues) => void
}

const FIELDS: ReadonlyArray<{
  kind: LimitKind
  key: keyof WorkspaceLimitValues
  label: string
}> = [
  { kind: 'models', key: 'maxModels', label: 'Max models' },
  { kind: 'members', key: 'maxMembers', label: 'Max members' },
]

const toText = (v: number | null) => (v == null ? '' : String(v))

/**
 * MODEL-SERVE-035. The workspace's caps on models and members. Blank = no
 * limit. A cap below the current count saves as asked: nothing is removed,
 * and new models / members are refused until the count is under it. The cap
 * binds admins too, so a full workspace is raised here first.
 */
export function AdminLimitsCard({
  workspaceId,
  limits,
  usage,
  onSaved,
}: AdminLimitsCardProps) {
  const [text, setText] = useState({
    maxModels: toText(limits.maxModels),
    maxMembers: toText(limits.maxMembers),
  })
  const [saving, setSaving] = useState(false)

  const parsed = {
    maxModels: parseLimitInput(text.maxModels),
    maxMembers: parseLimitInput(text.maxMembers),
  }
  const valid =
    parsed.maxModels !== undefined && parsed.maxMembers !== undefined
  const changed =
    parsed.maxModels !== limits.maxModels ||
    parsed.maxMembers !== limits.maxMembers

  async function save() {
    if (parsed.maxModels === undefined || parsed.maxMembers === undefined)
      return
    const next = { maxModels: parsed.maxModels, maxMembers: parsed.maxMembers }
    setSaving(true)
    try {
      const res = await workspaceService.adminUpdateWorkspaceLimits(
        workspaceId,
        next,
      )
      onSaved({
        maxModels: res.data.maxModels,
        maxMembers: res.data.maxMembers,
      })
      toast.success('Workspace limits updated')
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to update workspace limits',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Gauge className="h-4 w-4 text-primary" />
          Workspace Limits
        </CardTitle>
        <CardDescription>
          Cap models and members in this workspace. Leave blank for no limit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {FIELDS.map(({ kind, key, label }) => {
          const value = parsed[key]
          const invalid = value === undefined
          const note =
            value === undefined ? null : overLimitNote(kind, value, usage[kind])
          const inputId = `limit-${kind}`
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={inputId} className="text-xs">
                  {label}
                </Label>
                <span className="text-xs text-muted-foreground">
                  {usage[kind]} {kind} now
                </span>
              </div>
              <Input
                id={inputId}
                inputMode="numeric"
                placeholder="No limit"
                value={text[key]}
                aria-invalid={invalid}
                aria-describedby={`${inputId}-note`}
                disabled={saving}
                onChange={e => setText(t => ({ ...t, [key]: e.target.value }))}
              />
              <p id={`${inputId}-note`} className="text-xs text-foreground">
                {invalid ? (
                  <span className="text-destructive">
                    Enter a whole number from 1 to 10000, or leave blank.
                  </span>
                ) : note ? (
                  <span className="flex items-start gap-1.5">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {note}
                  </span>
                ) : null}
              </p>
            </div>
          )
        })}
        <Button
          className="w-full gap-2"
          onClick={() => void save()}
          disabled={!valid || !changed || saving}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save limits
        </Button>
      </CardContent>
    </Card>
  )
}
