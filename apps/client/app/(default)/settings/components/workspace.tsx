'use client'
import { useEffect, useRef, useState } from 'react'
import { Building2, ImagePlus, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { workspaceService } from '@/services/workspace'
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
import { toast } from 'sonner'
import { useSession } from 'next-auth/react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useUpdateWorkspace } from '@/hooks/workspace/use-update-workspace'
import { useDeleteWorkspace } from '@/hooks/workspace/use-delete-workspace'
import type { Workspace } from '@/types'
import { WorkspaceMembers } from '@/app/(default)/workspaces/[id]/components/workspace-members'
import { workspaceIcons, workspaceColors } from '@/store/workspace'
import Image from 'next/image'

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

export function WorkspaceTab() {
  const { data: session } = useSession()
  const { workspaces, refetch } = useWorkspaces()
  const { updateWorkspace, isUpdating } = useUpdateWorkspace()
  const { deleteWorkspace, isDeleting } = useDeleteWorkspace()
  const [preferredId, setPreferredId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Partial<Workspace>>>({})
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const [pendingThumbnail, setPendingThumbnail] = useState<File | null>(null)
  const [isUploadingThumbnail, setIsUploadingThumbnail] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedWorkspaceId = workspaces.some(w => w.id === preferredId)
    ? preferredId
    : (workspaces[0]?.id ?? '')
  const selectedWorkspace = workspaces.find(w => w.id === selectedWorkspaceId)
  const draft = drafts[selectedWorkspaceId] ?? {}
  const effectiveName = draft.name ?? selectedWorkspace?.name ?? ''
  const effectiveIcon = draft.icon ?? selectedWorkspace?.icon
  const effectiveColor = draft.color ?? selectedWorkspace?.color

  const handleSelectWorkspace = (id: string) => {
    if (id === selectedWorkspaceId) return
    setPreferredId(id)
    setThumbnailPreview(null)
    setPendingThumbnail(null)
    setDragOver(false)
  }

  const setField = (field: keyof Workspace, value: string) => {
    setDrafts(prev => ({
      ...prev,
      [selectedWorkspaceId]: { ...prev[selectedWorkspaceId], [field]: value },
    }))
  }

  const isOwner = session?.user?.id === selectedWorkspace?.ownerId

  const saveWorkspace = async () => {
    if (!selectedWorkspaceId) return
    const result = await updateWorkspace(selectedWorkspaceId, {
      name: effectiveName,
      icon: effectiveIcon,
      color: effectiveColor,
    })
    if (result.success) {
      setDrafts(prev => ({ ...prev, [selectedWorkspaceId]: {} }))
      toast.success('Workspace updated')
    } else {
      toast.error(result.error ?? 'Failed to update workspace')
    }
  }

  const handleDeleteWorkspace = async () => {
    if (!selectedWorkspaceId) return
    const result = await deleteWorkspace(selectedWorkspaceId)
    if (result.success) {
      setPreferredId('')
      toast.success('Workspace deleted')
    } else {
      toast.error(result.error ?? 'Failed to delete workspace')
    }
  }

  const handleThumbnailSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5 MB')
      return
    }
    setPendingThumbnail(file)
    setThumbnailPreview(URL.createObjectURL(file))
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Only image files are allowed')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5 MB')
      return
    }
    setPendingThumbnail(file)
    setThumbnailPreview(URL.createObjectURL(file))
  }
  const handleThumbnailUpload = async () => {
    if (!pendingThumbnail || !selectedWorkspaceId) return
    setIsUploadingThumbnail(true)
    try {
      await workspaceService.uploadWorkspaceThumbnail(
        selectedWorkspaceId,
        pendingThumbnail,
      )
      setPendingThumbnail(null)
      toast.success('Thumbnail uploaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploadingThumbnail(false)
    }
  }

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refetch?.()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refetch])

  const selectedColor =
    workspaceColors.find(c => c.id === effectiveColor)?.bg ?? 'bg-primary'
  const SelectedIcon =
    workspaceIcons.find(i => i.id === effectiveIcon)?.icon ?? Building2

  return (
    <>
      <div>
        <h2 className="text-xl font-semibold text-foreground">Workspace</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the name and appearance of each workspace.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {workspaces.map(w => (
          <button
            key={w.id}
            onClick={() => handleSelectWorkspace(w.id)}
            className={cn(
              'rounded-lg border-2 p-3 text-left transition-all',
              selectedWorkspaceId === w.id
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50',
            )}
          >
            <p className="text-xs font-medium text-foreground truncate">
              {w.name}
            </p>
          </button>
        ))}
      </div>

      {selectedWorkspace && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Workspace Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'h-14 w-14 rounded-xl flex items-center justify-center shadow',
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

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Icon
              </label>
              <div className="flex flex-wrap gap-2">
                {workspaceIcons.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    title={label}
                    onClick={() => setField('icon', id)}
                    className={cn(
                      'h-9 w-9 rounded-md border-2 flex items-center justify-center transition-all',
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

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Color
              </label>
              <div className="flex gap-2 py-2">
                {workspaceColors.map(({ id, bg }) => (
                  <button
                    key={id}
                    onClick={() => setField('color', id)}
                    className={cn(
                      'h-8 w-8 rounded-full transition-all',
                      bg,
                      effectiveColor === id
                        ? 'ring-2 ring-offset-2 ring-foreground scale-110'
                        : 'hover:scale-105 opacity-70 hover:opacity-100',
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Thumbnail
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleThumbnailSelect}
              />
              <div
                className={cn(
                  'group relative cursor-pointer overflow-hidden rounded-xl border-2 border-dashed transition-colors',
                  dragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50',
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {(thumbnailPreview ?? selectedWorkspace?.thumbnailUrl) ? (
                  <>
                    <Image
                      src={
                        thumbnailPreview ??
                        `${process.env.NEXT_PUBLIC_API_URL}${selectedWorkspace?.thumbnailUrl}`
                      }
                      alt="Workspace thumbnail"
                      width={256}
                      height={144}
                      className="h-36 w-full object-cover"
                      unoptimized={true}
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                      <Badge
                        variant="secondary"
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        Replace
                      </Badge>
                    </div>
                    {isUploadingThumbnail && (
                      <div className="absolute inset-0 flex flex-col justify-end bg-black/40">
                        <Progress
                          value={undefined}
                          className="m-2 h-1.5 w-[calc(100%-16px)] bg-white/20"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex h-36 flex-col items-center justify-center gap-2">
                    <ImagePlus
                      className={cn(
                        'h-7 w-7 transition-colors',
                        dragOver ? 'text-primary' : 'text-muted-foreground',
                      )}
                    />
                    <p className="text-xs text-muted-foreground">
                      {dragOver ? 'Drop to upload' : 'Click or drag image here'}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60">
                      JPEG, PNG, WebP · max 5 MB
                    </p>
                  </div>
                )}
              </div>
              {pendingThumbnail && (
                <div className="flex items-center justify-between">
                  <p className="truncate text-xs text-muted-foreground">
                    {pendingThumbnail.name}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isUploadingThumbnail}
                    onClick={handleThumbnailUpload}
                    className="ml-2 gap-1.5"
                  >
                    {isUploadingThumbnail && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Upload
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedWorkspace && (
        <div className="flex justify-end">
          <Button
            onClick={saveWorkspace}
            disabled={isUpdating}
            className="gap-2 min-w-32"
          >
            {isUpdating ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      )}

      {selectedWorkspace && isOwner && (
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
              <p className="text-xs text-muted-foreground mt-0.5">
                Permanently remove this workspace and all its data.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isDeleting}>
                  {isDeleting ? 'Deleting...' : 'Delete Workspace'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete{' '}
                    <strong>{selectedWorkspace.name}</strong> and all its data.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteWorkspace}
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

      {selectedWorkspaceId && (
        <WorkspaceMembers workspaceId={selectedWorkspaceId} />
      )}
    </>
  )
}
