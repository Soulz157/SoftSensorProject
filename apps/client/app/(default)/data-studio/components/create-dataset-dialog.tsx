import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  SelectTrigger,
  Select,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useDataSources } from '@/hooks/use-data-sources'
import { ChevronDown, Database, FolderPlus, Layers } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DataSourceKind } from '@/lib/mock-data-sources'
import { KIND_META } from '../create/components/add-connection-dialog'

export function CreateDatasetDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onConfirm: (
    name: string,
    description: string,
    workspaceId: string,
    sources: ReturnType<typeof useDataSources>['sources'],
  ) => void
}) {
  const { workspaces } = useWorkspaces()
  const { sources } = useDataSources()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [showSources, setShowSources] = useState(false)
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    new Set(),
  )

  const toggleSource = (id: string) =>
    setSelectedSourceIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleConfirm = () => {
    if (!name.trim() || !workspaceId) return
    const selectedSources = sources.filter(s => selectedSourceIds.has(s.id))
    onConfirm(name.trim(), description.trim(), workspaceId, selectedSources)
    setName('')
    setDescription('')
    setWorkspaceId('')
    setSelectedSourceIds(new Set())
    setShowSources(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Create Dataset
          </DialogTitle>
          <DialogDescription>
            Name your dataset, then pick data sources and tags in the wizard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Dataset name */}
          <div className="space-y-1.5">
            <Label htmlFor="ds-name" className="text-xs font-medium">
              Dataset name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ds-name"
              placeholder="e.g. Reactor Sensors Q2 2025"
              value={name}
              onChange={e => setName(e.target.value)}
              className="h-9 text-sm"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="ds-desc" className="text-xs font-medium">
              Description{' '}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              id="ds-desc"
              placeholder="What data does this dataset contain?"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="min-h-18 resize-none text-sm"
            />
          </div>

          {/* Target workspace */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Workspace <span className="text-destructive">*</span>
            </Label>
            <Select value={workspaceId} onValueChange={setWorkspaceId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select a workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map(w => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Data sources (optional) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Data sources{' '}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowSources(o => !o)}
              className="h-9 w-full justify-between gap-1.5 text-sm font-normal"
            >
              <span className="flex items-center gap-2">
                <Database className="h-3.5 w-3.5 text-muted-foreground" />
                Select data sources
              </span>
              <span className="flex items-center gap-1.5">
                {selectedSourceIds.size > 0 && (
                  <Badge variant="secondary" className="px-1.5">
                    {selectedSourceIds.size}
                  </Badge>
                )}
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform',
                    showSources && 'rotate-180',
                  )}
                />
              </span>
            </Button>

            {showSources && (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border bg-muted/40 p-2">
                {sources.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No data sources yet. Add one from the Data Sources page.
                  </p>
                ) : (
                  sources.map(s => {
                    const meta = KIND_META[s.type as DataSourceKind]
                    const Icon = meta?.icon ?? Database
                    const checked = selectedSourceIds.has(s.id)
                    return (
                      <label
                        key={s.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-background"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleSource(s.id)}
                          className="shrink-0"
                        />
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{s.name}</span>
                        <span className="truncate text-muted-foreground">
                          · {s.host}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            'ml-auto shrink-0 px-1.5 py-0 text-[10px]',
                            s.status === 'connected'
                              ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                              : 'border-amber-500/30 text-amber-600 dark:text-amber-400',
                          )}
                        >
                          {s.status === 'connected' ? 'Online' : 'Offline'}
                        </Badge>
                      </label>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!name.trim() || !workspaceId}
            onClick={handleConfirm}
            className="gap-1.5"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
