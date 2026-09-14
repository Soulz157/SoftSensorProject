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
  nameConflict: boolean
  onName: (v: string) => void
  onDescription: (v: string) => void
  onWorkspace: (id: string) => void
  onPlant: (id: string) => void
  onNode: (id: string) => void
}

/**
 * Two labelled regions instead of one flat stack (Law of Proximity / Common
 * Region) — Identity (name, description) is what the user types; Location
 * (workspace → plant → equipment) is what they pick. Both share one card
 * treatment so the grouping reads as structural, not decorative.
 */
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
  nameConflict,
  onName,
  onDescription,
  onWorkspace,
  onPlant,
  onNode,
}: Props) {
  const workspaces = useAtomValue(workspacesAtom)

  // Equipment is a real gate (canAdvance(1) requires nodeId !== ''), so the
  // column stays mounted at all times — never conditionally rendered — and
  // is only ever disabled with a reason. Mounting it conditionally beside
  // CascadeSelectors is what made the row jump when a plant was chosen.
  const equipmentHint = !workspaceId
    ? 'Pick a workspace first'
    : !plantId
      ? 'Pick a plant to list its equipment'
      : nodes.length === 0
        ? 'No equipment found in this plant. Add nodes to the canvas first.'
        : null

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-border">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Identity
        </h3>

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
            aria-invalid={nameConflict}
          />
          {nameConflict && (
            <p className="text-xs text-destructive">
              A model with this name already exists in this location.
            </p>
          )}
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
      </section>

      <section className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-border">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Location
        </h3>

        <div className="flex flex-col sm:flex-row gap-4 items-start w-full">
          <div className="space-y-1.5 flex-1 w-full">
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

          <div className="space-y-1.5 flex-1 w-full">
            <Label>
              Equipment<span className="text-destructive">*</span>
            </Label>
            {/*
             * `nodeId` has no "unassigned" state — canAdvance(1) requires
             * `nodeId !== ''`, so offering "— Unassigned —" would let a user
             * pick a value that silently disables Continue. `''` still
             * renders the placeholder (Radix Select shows placeholder on an
             * empty string value) and remains a valid intermediate state.
             */}
            <Select
              value={nodeId}
              onValueChange={onNode}
              disabled={disabled || !!equipmentHint}
            >
              <SelectTrigger className="h-9 w-56">
                <SelectValue placeholder="Select equipment" />
              </SelectTrigger>
              <SelectContent>
                {nodes.map(n => (
                  <SelectItem key={n.id} value={n.id}>
                    {(n.data as { name?: string }).name ?? n.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {equipmentHint && (
              <p className="text-xs text-muted-foreground">{equipmentHint}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
