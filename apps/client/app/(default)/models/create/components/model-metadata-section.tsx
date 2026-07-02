'use client'

import { useAtomValue } from 'jotai'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CascadeSelectors } from '@/app/(default)/data-visualize/components/cascade-selectors'
import { workspacesAtom } from '@/store/workspace'
import type { WorkspacePlant } from '@/types'
import type { CanvasNode } from '@/services/canvas'

interface Props {
  name: string
  description: string
  workspaceId: string
  plantId: string
  nodeId: string
  plants: WorkspacePlant[]
  nodes: CanvasNode[]
  plantsLoading: boolean
  disabled: boolean
  onName: (v: string) => void
  onDescription: (v: string) => void
  onWorkspace: (id: string) => void
  onPlant: (id: string) => void
  onNode: (id: string) => void
}

export function ModelMetadataSection({
  name,
  description,
  workspaceId,
  plantId,
  nodeId,
  plants,
  nodes,
  plantsLoading,
  disabled,
  onName,
  onDescription,
  onWorkspace,
  onPlant,
  onNode,
}: Props) {
  const workspaces = useAtomValue(workspacesAtom)

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="model-name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="model-name"
          placeholder="e.g. Temperature Predictor"
          value={name}
          onChange={e => onName(e.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="model-description">
          Description{' '}
          <span className="text-xs text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="model-description"
          placeholder="What this model predicts, its target, and any notes…"
          value={description}
          onChange={e => onDescription(e.target.value)}
          disabled={disabled}
          rows={4}
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          Workspace <span className="text-destructive">*</span> &amp; Plant{' '}
          <span className="text-destructive">*</span>
        </Label>
        <CascadeSelectors
          workspaces={workspaces}
          workspaceId={workspaceId}
          onWorkspaceChange={onWorkspace}
          plants={plants}
          plantId={plantId}
          onPlantChange={onPlant}
          plantsLoading={plantsLoading}
        />
      </div>

      {workspaceId && plantId && (
        <div className="space-y-1.5">
          <Label>
            Equipment<span className="text-destructive">*</span>
          </Label>
          <Select
            value={nodeId || 'none'}
            onValueChange={v => onNode(v === 'none' ? '' : v)}
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select equipment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Unassigned —</SelectItem>
              {nodes.map(n => (
                <SelectItem key={n.id} value={n.id}>
                  {(n.data as { name?: string }).name ?? n.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {nodes.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No equipment found in this plant. Add nodes to the canvas first.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
