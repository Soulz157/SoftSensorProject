'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useModelForm } from '@/hooks/model/use-model-form'
import { AIModel, Workspace } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  workspaces: Workspace[]
  model?: AIModel | null
}

export function ModelUpsertDialog({
  open,
  onClose,
  onSuccess,
  workspaces,
  model,
}: Props) {
  const { state, actions } = useModelForm({ open, model, onSuccess, onClose })
  const { name, workspaceId, plantId, nodeId, plants, nodes, isSubmitting } =
    state

  return (
    <Dialog open={open} onOpenChange={o => !o && !isSubmitting && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{model ? 'Edit Model' : 'New Model'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name Input */}
          <div className="space-y-1.5">
            <Label htmlFor="model-name">Name</Label>
            <Input
              id="model-name"
              placeholder="e.g. Temperature Predictor"
              value={name}
              onChange={e => actions.setName(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {/* Workspace Select */}
          <div className="space-y-1.5">
            <Label>Workspace</Label>
            <Select
              value={workspaceId || undefined}
              onValueChange={actions.handleWorkspaceChange}
              disabled={isSubmitting}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map(ws => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {workspaceId && (
            <div className="space-y-1.5">
              <Label>
                Plant{' '}
                <span className="text-xs text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Select
                value={plantId || 'none'}
                onValueChange={actions.handlePlantChange}
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select plant" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {plants.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Equipment/Node Select (Dependent on Workspace/Plant) */}
          {workspaceId && (
            <div className="space-y-1.5">
              <Label>
                Equipment / Node{' '}
                <span className="text-xs text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Select
                value={nodeId || 'none'}
                onValueChange={actions.handleNodeChange}
                disabled={isSubmitting}
              >
                <SelectTrigger>
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
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={actions.submitForm} disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : model ? 'Save Changes' : 'Create Model'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
