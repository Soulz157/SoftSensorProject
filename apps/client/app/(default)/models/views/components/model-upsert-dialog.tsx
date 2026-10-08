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
import Link from 'next/link'
import { ExternalLink, ServerCog } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sourceLabel } from '@/lib/model-data-source'
import { useModelDataSource } from '@/hooks/model/use-model-data-source'
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
  // MODEL-SERVE-013. Read here rather than inside `useModelForm`: the
  // binding is a SECOND record (the model's InferenceSchedule) behind its
  // own endpoint, and the form hook stays the owner of the model row alone.
  const dataSource = useModelDataSource(model?.id ?? null, open)
  const { state, actions } = useModelForm({
    open,
    model,
    onSuccess,
    onClose,
    dataSource,
  })
  const { name, workspaceId, plantId, nodeId, plants, nodes, isSubmitting } =
    state
  const isMissingSource = dataSource.view.state === 'missing-source'

  return (
    <Dialog open={open} onOpenChange={o => !o && !isSubmitting && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
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
              <Label>Plant</Label>
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
              <Label>Equipment </Label>
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

          {/* MODEL-SERVE-013. The REAL data source this model fetches live
              readings from, replacing the PI Server + Tag List block that
              used to sit here. That block read `MOCK_PI_SERVERS` and kept
              its selection in local state nothing ever sent anywhere — a
              control that looked like it named the model's source while
              naming nothing at all.

              EDIT ONLY. The binding lives on the model's InferenceSchedule,
              which does not exist until the model is deployed, so a model
              being CREATED has nothing to show or choose. */}
          {model && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <ServerCog className="h-3.5 w-3.5 text-muted-foreground" />
                  Data Source
                </Label>

                {dataSource.loading ? (
                  <div className="h-9 animate-pulse rounded-md bg-muted" />
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          'truncate text-sm font-medium',
                          isMissingSource
                            ? 'font-mono text-red-500'
                            : 'text-foreground',
                        )}
                      >
                        {sourceLabel(dataSource.currentSource)}
                      </span>
                      {/* There is no per-source detail route; the list page
                          is where a source is opened and edited. */}
                      <Link
                        href="/data-sources"
                        className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Data Sources
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>

                    {dataSource.view.canRelink && (
                      <Select
                        value={dataSource.selectedId ?? undefined}
                        onValueChange={dataSource.setSelectedId}
                        disabled={isSubmitting}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select data source" />
                        </SelectTrigger>
                        <SelectContent>
                          {dataSource.candidates.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name ?? s.id}
                              {s.type ? ` · ${s.type}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    <p
                      className={cn(
                        'text-xs',
                        isMissingSource
                          ? 'text-red-500'
                          : 'text-muted-foreground',
                      )}
                    >
                      {dataSource.error ?? dataSource.view.note}
                    </p>

                    {/* The warning is ON SCREEN BEFORE the write, never
                        after: relinking re-points where live readings come
                        from and does NOT retrain, so the model keeps
                        weights fitted on the old source's data. */}
                    {dataSource.isDirty && (
                      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                        This only re-points future data collection. The model
                        stays trained on data from{' '}
                        <span className="font-medium">
                          {sourceLabel(dataSource.currentSource)}
                        </span>{' '}
                        — its accuracy on the new source is not verified.
                        Retrain if the two differ.
                      </p>
                    )}
                  </>
                )}
              </div>
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
