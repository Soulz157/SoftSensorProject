'use client'

import { useState } from 'react'
import {
  Building2,
  Box,
  Cpu,
  Gauge,
  Thermometer,
  Activity,
  Globe,
  Shield,
  Camera,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useUpdateWorkspace } from '@/hooks/workspace/use-update-workspace'
import type { Workspace } from '@/types'

const workspaceIcons = [
  { id: 'building', label: 'Building', icon: Building2 },
  { id: 'box', label: 'Box', icon: Box },
  { id: 'cpu', label: 'CPU', icon: Cpu },
  { id: 'gauge', label: 'Gauge', icon: Gauge },
  { id: 'thermometer', label: 'Thermometer', icon: Thermometer },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'globe', label: 'Globe', icon: Globe },
  { id: 'shield', label: 'Shield', icon: Shield },
]

const workspaceColors = [
  { id: 'blue', bg: 'bg-blue-500' },
  { id: 'violet', bg: 'bg-violet-500' },
  { id: 'emerald', bg: 'bg-emerald-500' },
  { id: 'amber', bg: 'bg-amber-500' },
  { id: 'rose', bg: 'bg-rose-500' },
  { id: 'cyan', bg: 'bg-cyan-500' },
]

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

export function WorkspaceTab() {
  const { workspaces } = useWorkspaces()
  const { updateWorkspace, isUpdating } = useUpdateWorkspace()
  const [preferredId, setPreferredId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Partial<Workspace>>>({})

  const selectedWorkspaceId = workspaces.some(w => w.id === preferredId)
    ? preferredId
    : (workspaces[0]?.id ?? '')

  const selectedWorkspace = workspaces.find(w => w.id === selectedWorkspaceId)
  const draft = drafts[selectedWorkspaceId] ?? {}

  const effectiveName = draft.name ?? selectedWorkspace?.name ?? ''
  const effectiveIcon = draft.icon ?? selectedWorkspace?.icon
  const effectiveColor = draft.color ?? selectedWorkspace?.color

  const setField = (field: keyof Workspace, value: string) => {
    setDrafts(prev => ({
      ...prev,
      [selectedWorkspaceId]: { ...prev[selectedWorkspaceId], [field]: value },
    }))
  }

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
            onClick={() => setPreferredId(w.id)}
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
                Or Upload Custom Image
              </label>
              <label className="flex items-center gap-2 cursor-pointer w-fit rounded-md border border-dashed border-border px-4 py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors">
                <Camera className="h-4 w-4" />
                Choose Image
                <input type="file" accept="image/*" className="hidden" />
              </label>
              <p className="text-xs text-muted-foreground">
                PNG, JPG up to 2 MB
              </p>
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
    </>
  )
}
