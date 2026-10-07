'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUpdateMemberAccess } from '@/hooks/workspace/use-update-member-access'
import {
  WORKSPACE_PERMISSION_OPTIONS,
  WORKSPACE_ROLE_OPTIONS,
} from '@/lib/workspace-access'
import { cn } from '@/lib/utils'
import type {
  WorkspaceMember,
  WorkspacePermission,
  WorkspaceRole,
} from '@/types'

interface MemberAccessDialogProps {
  workspaceId: string
  /** Mount with `key={member.id}` so the form starts from this member. */
  member: WorkspaceMember
  memberName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function MemberAccessDialog({
  workspaceId,
  member,
  memberName,
  open,
  onOpenChange,
  onSaved,
}: MemberAccessDialogProps) {
  const [role, setRole] = useState<WorkspaceRole>(member.role)
  const [permissions, setPermissions] = useState<WorkspacePermission[]>(
    member.permissions ?? [],
  )
  const { updateMemberAccess, isSaving } = useUpdateMemberAccess(workspaceId)

  const grantsApply = role === 'VIEWER'

  function toggle(permission: WorkspacePermission, on: boolean) {
    setPermissions(prev =>
      on ? [...prev, permission] : prev.filter(p => p !== permission),
    )
  }

  async function handleSave() {
    const ok = await updateMemberAccess(member, role, permissions)
    if (!ok) return
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage access</DialogTitle>
          <DialogDescription>
            Role and feature access for {memberName}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="member-role" className="text-xs">
              Role
            </Label>
            <Select
              value={role}
              onValueChange={v => setRole(v as WorkspaceRole)}
              disabled={isSaving}
            >
              <SelectTrigger id="member-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSPACE_ROLE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {o.description}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-2" disabled={!grantsApply || isSaving}>
            <legend className="text-xs font-medium text-foreground">
              Feature access
            </legend>
            <p className="text-xs text-muted-foreground">
              {grantsApply
                ? 'Let this viewer see more. Grants are read-only — they never allow edits.'
                : 'Owners and staff already have this access.'}
            </p>
            <div className="space-y-1">
              {WORKSPACE_PERMISSION_OPTIONS.map(o => {
                const checked = grantsApply
                  ? permissions.includes(o.value)
                  : true
                return (
                  <label
                    key={o.value}
                    className={cn(
                      'flex items-start gap-3 rounded-md px-2 py-2',
                      grantsApply
                        ? 'cursor-pointer hover:bg-muted'
                        : 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={!grantsApply || isSaving}
                      className="mt-0.5"
                      onCheckedChange={on => toggle(o.value, on === true)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground">
                        {o.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {o.description}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
