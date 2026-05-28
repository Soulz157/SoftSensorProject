'use client'

import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { workspaceService } from '@/services/workspace'
import type { AdminWorkspace } from '@/types'

interface WorkspaceSettingsDialogProps {
  workspace: AdminWorkspace
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

export function WorkspaceSettingsDialog({
  workspace,
  open,
  onOpenChange,
  onSuccess,
}: WorkspaceSettingsDialogProps) {
  const [name, setName] = useState(workspace.name)
  const [icon, setIcon] = useState(workspace.icon)
  const [color, setColor] = useState(workspace.color)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const ownerName = [workspace.owner.firstName, workspace.owner.lastName]
    .filter(Boolean)
    .join(' ')

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Workspace name is required')
      return
    }
    setIsSaving(true)
    try {
      await workspaceService.updateWorkspace(workspace.id, {
        name,
        icon,
        color,
      })
      toast.success('Workspace updated')
      onSuccess()
      onOpenChange(false)
    } catch {
      toast.error('Failed to update workspace')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    setIsDeleting(true)
    try {
      await workspaceService.deleteWorkspace(workspace.id)
      toast.success('Workspace deleted')
      onSuccess()
      onOpenChange(false)
    } catch {
      toast.error('Failed to delete workspace')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
          <DialogDescription>
            Edit workspace details or remove it from the platform.
          </DialogDescription>
        </DialogHeader>

        {/* Owner info (read-only) */}
        <div className="rounded-md bg-muted/50 px-3 py-2.5 space-y-0.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Owner
          </p>
          <p className="text-sm font-medium text-foreground">
            {ownerName || '—'}
          </p>
          <p className="text-xs text-muted-foreground">
            {workspace.owner.email}
          </p>
        </div>

        {/* Edit fields */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Name</label>
            <input
              className={inputClass}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Workspace name"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Icon</label>
            <input
              className={inputClass}
              value={icon}
              onChange={e => setIcon(e.target.value)}
              placeholder="Icon (e.g. emoji or slug)"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color.startsWith('#') ? color : '#6366f1'}
                onChange={e => setColor(e.target.value)}
                className="h-9 w-10 cursor-pointer rounded-md border border-input bg-background p-1"
              />
              <input
                className={inputClass}
                value={color}
                onChange={e => setColor(e.target.value)}
                placeholder="#6366f1"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {/* Danger zone */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={isDeleting}>
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1.5" />
                )}
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove &quot;{workspace.name}&quot; and
                  all its models. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Save changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
