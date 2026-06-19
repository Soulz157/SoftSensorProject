'use client'
import { useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import {
  Building2,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Factory,
  Package,
  Settings2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useModelHierarchy } from '@/hooks/model/use-model-hierarchy'
import {
  workspaceColors,
  workspaceIcons,
  workspacesAtom,
} from '@/store/workspace'
import { NODE_DOT } from '@/constants/status'

// A selection scope: clicking any tree row scopes the main table to it.
export type TreeScope = {
  level: 'workspace' | 'plant' | 'node' | 'model'
  id: string
}

interface WorkTreePanelProps {
  selectedScope: TreeScope | null
  onSelectScope: (scope: TreeScope) => void
}

type TreeModel = { id: string; name: string }
type TreeNode = {
  id: string
  name: string
  status: string
  models: TreeModel[]
}
type TreePlant = { id: string; name: string; nodes: TreeNode[] }
type TreeWorkspace = {
  id: string
  name: string
  icon?: string
  color?: string
  plants: TreePlant[]
}

function CountBadge({ n }: { n: number }) {
  if (n === 0) return null
  return (
    <Badge
      variant="outline"
      className="h-4 px-1.5 text-[9px] font-medium text-muted-foreground"
    >
      {n}
    </Badge>
  )
}

function EmptyHint({ label }: { label: string }) {
  return (
    <p className="px-2 py-1 text-[11px] text-muted-foreground/50">{label}</p>
  )
}

const childIndent = 'ml-4 border-l border-border/40 pl-2'

// A row with a chevron that toggles expansion and a body that selects the scope.
// Chevron click is isolated so expanding never changes the active filter.
function ScopeRow({
  id,
  level,
  selected,
  hasChildren,
  isOpen,
  toggle,
  onSelect,
  children,
}: {
  id: string
  level: TreeScope['level']
  selected: boolean
  hasChildren: boolean
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
  onSelect: (scope: TreeScope) => void
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-2 py-1.5',
        selected
          ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
          : 'hover:bg-accent',
      )}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={isOpen(id) ? 'Collapse' : 'Expand'}
          aria-expanded={isOpen(id)}
          onClick={() => toggle(id)}
          className="shrink-0"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 text-muted-foreground transition-transform',
              isOpen(id) && 'rotate-90',
            )}
          />
        </button>
      ) : (
        <span className="h-3 w-3 shrink-0" />
      )}
      <button
        type="button"
        onClick={() => onSelect({ level, id })}
        aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {children}
      </button>
    </div>
  )
}

export function WorkTreePanel({
  selectedScope,
  onSelectScope,
}: WorkTreePanelProps) {
  const workspaces = useAtomValue(workspacesAtom)
  const { plantsByWorkspaceId, nodesByWorkspaceId, loading, error } =
    useModelHierarchy()

  const [openItems, setOpenItems] = useState<string[]>([])
  const isOpen = (id: string) => openItems.includes(id)
  const toggle = (id: string) =>
    setOpenItems(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    )
  const isSel = (level: TreeScope['level'], id: string) =>
    selectedScope?.level === level && selectedScope.id === id

  const tree = useMemo<TreeWorkspace[]>(
    () =>
      workspaces.map(ws => ({
        id: ws.id,
        name: ws.name,
        icon: ws.icon,
        color: ws.color,
        plants: (plantsByWorkspaceId[ws.id] ?? []).map(plant => ({
          id: plant.id,
          name: plant.name,
          nodes: (nodesByWorkspaceId[ws.id] ?? [])
            .filter(n => n.planId === plant.id)
            .map(n => ({
              id: n.id,
              name: n.data.name,
              status: n.data.status ?? 'normal',
              models: n.models.map(m => ({ id: m.id, name: m.name })),
            })),
        })),
      })),
    [workspaces, plantsByWorkspaceId, nodesByWorkspaceId],
  )

  const allIds = useMemo(
    () => [
      ...tree.map(ws => ws.id),
      ...tree.flatMap(ws => ws.plants.map(p => p.id)),
      ...tree.flatMap(ws => ws.plants.flatMap(p => p.nodes.map(n => n.id))),
    ],
    [tree],
  )

  const allExpanded =
    allIds.length > 0 && allIds.every(id => openItems.includes(id))
  const handleToggleAll = () => setOpenItems(allExpanded ? [] : allIds)

  // Expand the path down to the selected scope so it stays visible.
  useEffect(() => {
    if (!selectedScope) return
    for (const ws of tree)
      for (const plant of ws.plants)
        for (const node of plant.nodes) {
          const hit =
            (selectedScope.level === 'plant' &&
              selectedScope.id === plant.id) ||
            (selectedScope.level === 'node' && selectedScope.id === node.id) ||
            (selectedScope.level === 'model' &&
              node.models.some(m => m.id === selectedScope.id))
          if (hit) {
            setOpenItems(prev => [
              ...new Set([...prev, ws.id, plant.id, node.id]),
            ])
            return
          }
        }
  }, [selectedScope, tree])

  return (
    <nav
      aria-label="Asset hierarchy"
      className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-card"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Asset Overview
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          onClick={handleToggleAll}
          title={allExpanded ? 'Collapse all' : 'Expand all'}
        >
          {allExpanded ? (
            <ChevronsDownUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="space-y-2 px-3 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full rounded" />
            ))}
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-xs text-destructive">{error}</div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Building2 className="h-7 w-7 text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground">No workspaces</p>
          </div>
        ) : (
          <div className="px-1 py-1">
            {tree.map(ws => {
              const WsIcon =
                workspaceIcons.find(i => i.id === ws.icon)?.icon ?? Building2
              const colorBg =
                workspaceColors.find(c => c.id === ws.color)?.bg ?? 'bg-muted'

              return (
                <div key={ws.id}>
                  <ScopeRow
                    id={ws.id}
                    level="workspace"
                    selected={isSel('workspace', ws.id)}
                    hasChildren={ws.plants.length > 0}
                    isOpen={isOpen}
                    toggle={toggle}
                    onSelect={onSelectScope}
                  >
                    <span
                      className={cn('h-2 w-2 shrink-0 rounded-full', colorBg)}
                    />
                    <WsIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span
                      className="flex-1 truncate text-[11px] font-medium"
                      title={ws.name}
                    >
                      {ws.name}
                    </span>
                    <CountBadge n={ws.plants.length} />
                  </ScopeRow>

                  {isOpen(ws.id) && (
                    <div className={childIndent}>
                      {ws.plants.length === 0 ? (
                        <EmptyHint label="No plants" />
                      ) : (
                        ws.plants.map(plant => (
                          <div key={plant.id}>
                            <ScopeRow
                              id={plant.id}
                              level="plant"
                              selected={isSel('plant', plant.id)}
                              hasChildren={plant.nodes.length > 0}
                              isOpen={isOpen}
                              toggle={toggle}
                              onSelect={onSelectScope}
                            >
                              <Factory className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <span
                                className="flex-1 truncate text-[11px] font-medium"
                                title={plant.name}
                              >
                                {plant.name}
                              </span>
                              <CountBadge n={plant.nodes.length} />
                            </ScopeRow>

                            {isOpen(plant.id) && (
                              <div className={childIndent}>
                                {plant.nodes.length === 0 ? (
                                  <EmptyHint label="No equipment" />
                                ) : (
                                  plant.nodes.map(node => (
                                    <div key={node.id}>
                                      <ScopeRow
                                        id={node.id}
                                        level="node"
                                        selected={isSel('node', node.id)}
                                        hasChildren={node.models.length > 0}
                                        isOpen={isOpen}
                                        toggle={toggle}
                                        onSelect={onSelectScope}
                                      >
                                        <Settings2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                                        <span
                                          className={cn(
                                            'h-1.5 w-1.5 shrink-0 rounded-full',
                                            NODE_DOT[node.status] ?? 'bg-muted',
                                          )}
                                        />
                                        <span
                                          className="flex-1 truncate text-[11px] font-medium"
                                          title={node.name}
                                        >
                                          {node.name}
                                        </span>
                                        <CountBadge n={node.models.length} />
                                      </ScopeRow>

                                      {isOpen(node.id) && (
                                        <div
                                          className={cn(
                                            childIndent,
                                            'space-y-px py-0.5',
                                          )}
                                        >
                                          {node.models.length === 0 ? (
                                            <EmptyHint label="No models" />
                                          ) : (
                                            node.models.map(model => (
                                              <ScopeRow
                                                key={model.id}
                                                id={model.id}
                                                level="model"
                                                selected={isSel(
                                                  'model',
                                                  model.id,
                                                )}
                                                hasChildren={false}
                                                isOpen={isOpen}
                                                toggle={toggle}
                                                onSelect={onSelectScope}
                                              >
                                                <Package className="h-3 w-3 shrink-0 text-muted-foreground" />
                                                <span
                                                  className="flex-1 truncate text-[11px]"
                                                  title={model.name}
                                                >
                                                  {model.name}
                                                </span>
                                              </ScopeRow>
                                            ))
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </nav>
  )
}
