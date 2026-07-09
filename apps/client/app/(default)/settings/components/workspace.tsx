'use client'
import { useEffect, useRef, useState } from 'react'
import { Building2, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
      toast.success('Workspace updated successfully')
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
      toast.success('Thumbnail uploaded successfully')
      refetch?.() // ดึงข้อมูลใหม่หลังจากอัปโหลดเสร็จเพื่อให้แสดง URL ล่าสุด
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploadingThumbnail(false)
    }
  }

  const cancelThumbnailUpload = () => {
    setPendingThumbnail(null)
    setThumbnailPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
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
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Workspace</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the name and appearance of each workspace.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {workspaces.map(w => (
          <button
            key={w.id}
            onClick={() => handleSelectWorkspace(w.id)}
            className={cn(
              'rounded-lg border-2 p-3 text-left transition-all',
              selectedWorkspaceId === w.id
                ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                : 'border-border hover:border-primary/50 bg-card',
            )}
          >
            <p className="text-sm font-medium text-foreground truncate">
              {w.name}
            </p>
          </button>
        ))}
      </div>

      {selectedWorkspace && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Workspace Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'h-14 w-14 rounded-xl flex items-center justify-center shadow-sm shrink-0',
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
                  Live preview of your workspace icon
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace Name</Label>
              <Input
                id="workspace-name"
                value={effectiveName}
                onChange={e => setField('name', e.target.value)}
                placeholder="Enter workspace name"
                className="max-w-md"
              />
            </div>

            <div className="space-y-3">
              <Label>Default Icon</Label>
              <div className="flex flex-wrap gap-2">
                {workspaceIcons.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    title={label}
                    onClick={() => setField('icon', id)}
                    className={cn(
                      'h-10 w-10 rounded-md border flex items-center justify-center transition-all',
                      effectiveIcon === id
                        ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                        : 'border-input bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Label>Theme Color</Label>
              <div className="flex gap-2">
                {workspaceColors.map(({ id, bg }) => (
                  <button
                    key={id}
                    onClick={() => setField('color', id)}
                    className={cn(
                      'h-8 w-8 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      bg,
                      effectiveColor === id
                        ? 'ring-2 ring-offset-2 ring-offset-card scale-110'
                        : 'hover:scale-105 opacity-80 hover:opacity-100',
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Label>Thumbnail Image</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleThumbnailSelect}
              />
              <div
                className={cn(
                  'group relative cursor-pointer overflow-hidden rounded-xl border-2 border-dashed transition-all max-w-md',
                  dragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-input hover:border-primary/50 hover:bg-accent/50',
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
                      width={400}
                      height={225}
                      className="h-40 w-full object-cover"
                      unoptimized={true}
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <Badge variant="secondary" className="shadow-sm">
                        Replace Image
                      </Badge>
                    </div>
                    {isUploadingThumbnail && (
                      <div className="absolute inset-0 flex flex-col justify-end bg-black/50 p-3">
                        <Progress
                          value={undefined} // กำหนดเป็น indeterminate state
                          className="h-2 w-full bg-white/20"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex h-40 flex-col items-center justify-center gap-3">
                    <div className="rounded-full bg-primary/10 p-3">
                      <ImagePlus
                        className={cn(
                          'h-6 w-6 transition-colors',
                          dragOver ? 'text-primary' : 'text-primary/60',
                        )}
                      />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">
                        {dragOver
                          ? 'Drop image here'
                          : 'Click or drag image to upload'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        JPEG, PNG, WebP (Max 5MB)
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons when a new thumbnail is selected but not yet uploaded */}
              {pendingThumbnail && (
                <div className="flex items-center justify-between max-w-md rounded-lg border bg-muted/40 px-3 py-2">
                  <div className="flex items-center gap-2 overflow-hidden pr-2">
                    <ImagePlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <p className="truncate text-xs text-muted-foreground">
                      {pendingThumbnail.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={cancelThumbnailUpload}
                      disabled={isUploadingThumbnail}
                      title="Cancel upload"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-3 text-xs"
                      disabled={isUploadingThumbnail}
                      onClick={handleThumbnailUpload}
                    >
                      {isUploadingThumbnail && (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      )}
                      Upload
                    </Button>
                  </div>
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
            className="min-w-32"
          >
            {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isUpdating ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      )}

      {selectedWorkspace && isOwner && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-base font-medium text-destructive">
              Danger Zone
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">
                Delete Workspace
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Permanently remove this workspace, including all associated
                models and data.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isDeleting}>
                  {isDeleting ? 'Deleting...' : 'Delete Workspace'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete
                    the{' '}
                    <span className="font-semibold text-foreground">
                      {selectedWorkspace.name}
                    </span>{' '}
                    workspace and all of its associated data.
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
    </div>
  )
}
