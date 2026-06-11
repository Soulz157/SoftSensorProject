'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from 'next-auth/react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useUpdateWorkspace } from '@/hooks/workspace/use-update-workspace'
import { useDeleteWorkspace } from '@/hooks/workspace/use-delete-workspace'
import { workspaceIcons, workspaceColors } from '@/store/workspace'
import { WorkspaceMembers } from '@/app/(default)/settings/components/workspace-members'
import type { Workspace } from '@/types'

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

interface WorkspaceSettingsSheetProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkspaceSettingsSheet({
  workspaceId,
  open,
  onOpenChange,
}: WorkspaceSettingsSheetProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const { workspaces } = useWorkspaces()
  const { updateWorkspace, isUpdating } = useUpdateWorkspace()
  const { deleteWorkspace, isDeleting } = useDeleteWorkspace()

  const workspace = workspaces.find(w => w.id === workspaceId)
  const [draft, setDraft] = useState<Partial<Workspace>>({})

  const effectiveName = draft.name ?? workspace?.name ?? ''
  const effectiveIcon = draft.icon ?? workspace?.icon
  const effectiveColor = draft.color ?? workspace?.color

  const isOwner = session?.user?.id === workspace?.ownerId

  const setField = (field: keyof Workspace, value: string) => {
    setDraft(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    if (!workspaceId) return
    const result = await updateWorkspace(workspaceId, {
      name: effectiveName,
      icon: effectiveIcon,
      color: effectiveColor,
      description: workspace?.description ?? '',
    })
    if (result.success) {
      setDraft({})
      toast.success('Workspace updated')
    } else {
      toast.error(result.error ?? 'Failed to update workspace')
    }
  }

  const handleDelete = async () => {
    if (!workspaceId) return
    const result = await deleteWorkspace(workspaceId)
    if (result.success) {
      toast.success('Workspace deleted')
      onOpenChange(false)
      router.push('/workspaces')
    } else {
      toast.error(result.error ?? 'Failed to delete workspace')
    }
  }

  const selectedColor =
    workspaceColors.find(c => c.id === effectiveColor)?.bg ?? 'bg-primary'
  const SelectedIcon =
    workspaceIcons.find(i => i.id === effectiveIcon)?.icon ?? Building2

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="mb-6">
          <SheetTitle>Workspace Settings</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 p-4">
          {/* Icon preview */}
          {workspace && (
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'flex h-14 w-14 items-center justify-center rounded-xl shadow',
                  selectedColor,
                )}
              >
                <SelectedIcon className="h-7 w-7 text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {effectiveName}
                </p>
                <p className="text-xs text-muted-foreground">
                  Workspace icon preview
                </p>
              </div>
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Workspace Name
            </label>
            <input
              className={inputClass}
              value={effectiveName}
              onChange={e => setField('name', e.target.value)}
            />
          </div>

          {/* Icon picker */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Icon</label>
            <div className="flex flex-wrap gap-2">
              {workspaceIcons.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  title={label}
                  onClick={() => setField('icon', id)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-md border-2 transition-all',
                    effectiveIcon === id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          {/* Color picker */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Color</label>
            <div className="flex gap-2 py-1">
              {workspaceColors.map(({ id, bg }) => (
                <button
                  key={id}
                  onClick={() => setField('color', id)}
                  className={cn(
                    'h-8 w-8 rounded-full transition-all',
                    bg,
                    effectiveColor === id
                      ? 'scale-110 ring-2 ring-foreground ring-offset-2'
                      : 'opacity-70 hover:scale-105 hover:opacity-100',
                  )}
                />
              ))}
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={isUpdating}
              className="min-w-32 gap-2"
            >
              {isUpdating ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>

          {/* Members */}
          {workspaceId && <WorkspaceMembers workspaceId={workspaceId} />}

          {/* Danger zone */}
          {workspace && isOwner && (
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-destructive">
                  Danger Zone
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Delete this workspace
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Permanently remove this workspace and all its data.
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isDeleting}
                    >
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete{' '}
                        <strong>{workspace.name}</strong> and all its data. This
                        action cannot be undone.
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
              </CardContent>
            </Card>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
