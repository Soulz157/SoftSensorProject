'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Workspace, WorkspacePlant } from '@/types'

interface Props {
  workspaces: Workspace[]
  workspaceId: string
  onWorkspaceChange: (id: string) => void
  plants: WorkspacePlant[]
  plantId: string
  onPlantChange: (id: string) => void
  plantsLoading: boolean
}

export function CascadeSelectors({
  workspaces,
  workspaceId,
  onWorkspaceChange,
  plants,
  plantId,
  onPlantChange,
  plantsLoading,
}: Props) {
  const hasWorkspace = workspaceId !== ''
  const plantPlaceholder = !hasWorkspace
    ? 'Select a workspace first'
    : plantsLoading
      ? 'Loading plants…'
      : plants.length === 0
        ? 'No plants in workspace'
        : 'Select a plant'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={workspaceId} onValueChange={onWorkspaceChange}>
        <SelectTrigger className="h-9 w-56">
          <SelectValue placeholder="Select a workspace" />
        </SelectTrigger>
        <SelectContent>
          {workspaces.map(ws => (
            <SelectItem key={ws.id} value={ws.id}>
              {ws.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-muted-foreground">›</span>

      <Select
        value={plantId}
        onValueChange={onPlantChange}
        disabled={!hasWorkspace || plantsLoading || plants.length === 0}
      >
        <SelectTrigger className="h-9 w-56">
          <SelectValue placeholder={plantPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {plants.map(p => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
