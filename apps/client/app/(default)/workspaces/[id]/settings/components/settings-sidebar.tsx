'use client'

import { Info, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SettingsTab } from '../page'
import { Button } from '@/components/ui/button'
import { useDeleteWorkspace } from '@/hooks/workspace/use-delete-workspace'
import { toast } from 'sonner'
import { CardContent } from '@/components/ui/card'
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
import { useSession } from 'next-auth/react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useEffect, useState } from 'react'

interface SettingsSidebarProps {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  workspaceId: string
}

export function SettingsSidebar({
  activeTab,
  onTabChange,
  workspaceId,
}: SettingsSidebarProps) {
  const { data: session } = useSession()
  const { workspaces, refetch } = useWorkspaces()
  const [preferredId, setPreferredId] = useState('')

  const selectedWorkspaceId = workspaces.some(w => w.id === preferredId)
    ? preferredId
    : (workspaces[0]?.id ?? '')
  const selectedWorkspace = workspaces.find(w => w.id === selectedWorkspaceId)
  const isOwner = session?.user.id === selectedWorkspace?.ownerId
  const tabs = [
    {
      id: 'info' as SettingsTab,
      label: 'General Info',
      icon: <Info className="h-4 w-4" />,
    },
    {
      id: 'members' as SettingsTab,
      label: 'Members/Team',
      icon: <Users className="h-4 w-4" />,
    },
  ]

  const { deleteWorkspace, isDeleting } = useDeleteWorkspace()

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refetch?.()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refetch])

  const handleDeleteWorkspace = async () => {
    if (!workspaceId) return
    const result = await deleteWorkspace(workspaceId)
    if (result.success) {
      setPreferredId('')
      toast.success('Workspace deleted successfully')
    } else {
      toast.error('Failed to delete workspace')
    }
  }

  return (
    <div className="w-52 shrink-0 border-r border-border bg-card">
      <div className="border-b border-border p-4">
        <h1 className="text-base font-semibold text-foreground">Settings</h1>
      </div>
      <nav className="space-y-1 p-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      {selectedWorkspace && isOwner && (
        <div className="border-t border-border p-4">
          <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
        </div>
      )}
    </div>
  )
}
