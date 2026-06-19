'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  ChevronRight,
  Factory,
  Package,
  Settings2,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { NODE_BADGE, NODE_DOT } from '@/constants/status'
import { buildOverviewTree } from '@/lib/overview-tree'
import type { NodeStatus } from '@/store/status-colors'
import type { CanvasNode } from '@/services/canvas'
import type { AIModel, WorkspacePlant } from '@/types'

interface OverviewAssetTreeProps {
  plants: WorkspacePlant[]
  nodes: CanvasNode[]
  models: AIModel[]
  loading: boolean
}

const childIndent = 'ml-4 border-l border-border/40 pl-2'

// Right-aligned status pill (dot + label) shown on every tree row so an alarm
// can be traced from plant down to the model it originates on.
function StatusTag({ status }: { status: NodeStatus }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5">
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          NODE_DOT[status] ?? 'bg-zinc-400',
          status === 'alarm' &&
            'ring-4 ring-destructive/20 motion-safe:animate-pulse',
        )}
      />
      <span
        className={cn(
          'text-[10px] font-semibold capitalize',
          NODE_BADGE[status] ?? 'text-muted-foreground',
        )}
      >
        {status}
      </span>
    </span>
  )
}

function DisclosureRow({
  id,
  isOpen,
  toggle,
  icon,
  name,
  status,
}: {
  id: string
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
  icon: React.ReactNode
  name: string
  status: NodeStatus
}) {
  return (
    <button
      type="button"
      aria-expanded={isOpen(id)}
      onClick={() => toggle(id)}
      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-accent"
    >
      <ChevronRight
        className={cn(
          'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
          isOpen(id) && 'rotate-90',
        )}
      />
      {icon}
      <span
        className="truncate text-[11px] font-medium text-foreground"
        title={name}
      >
        {name}
      </span>
      <StatusTag status={status} />
    </button>
  )
}

function EmptyHint({ label }: { label: string }) {
  return (
    <p className="px-2 py-1 text-[11px] text-muted-foreground/50">{label}</p>
  )
}

export function OverviewAssetTree({
  plants,
  nodes,
  models,
  loading,
}: OverviewAssetTreeProps) {
  const tree = useMemo(
    () => buildOverviewTree(plants, nodes, models),
    [plants, nodes, models],
  )

  const [openItems, setOpenItems] = useState<string[]>([])
  const isOpen = (id: string) => openItems.includes(id)
  const toggle = (id: string) =>
    setOpenItems(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    )

  // Auto-expand every plant + equipment that carries a non-normal status so the
  // critical paths are visible the moment the panel opens.
  useEffect(() => {
    const ids: string[] = []
    for (const plant of tree) {
      if (plant.status !== 'normal') ids.push(plant.id)
      for (const node of plant.nodes) {
        if (node.status !== 'normal') ids.push(node.id)
      }
    }
    setOpenItems(ids)
  }, [tree])

  if (loading) {
    return (
      <div className="space-y-2 px-4 py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full rounded" />
        ))}
      </div>
    )
  }

  return (
    <div className="px-2 py-3">
      <div className="mb-1 px-2 text-xs font-medium text-muted-foreground">
        Asset Hierarchy
      </div>
      {tree.length === 0 ? (
        <EmptyHint label="No assets in this workspace" />
      ) : (
        tree.map(plant => (
          <div key={plant.id}>
            <DisclosureRow
              id={plant.id}
              isOpen={isOpen}
              toggle={toggle}
              icon={
                <Factory className="h-3 w-3 shrink-0 text-muted-foreground" />
              }
              name={plant.name}
              status={plant.status}
            />

            {isOpen(plant.id) && (
              <div className={childIndent}>
                {plant.nodes.length === 0 ? (
                  <EmptyHint label="No equipment" />
                ) : (
                  plant.nodes.map(node => (
                    <div key={node.id}>
                      <DisclosureRow
                        id={node.id}
                        isOpen={isOpen}
                        toggle={toggle}
                        icon={
                          <Settings2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                        }
                        name={node.name}
                        status={node.status}
                      />

                      {isOpen(node.id) && (
                        <div className={cn(childIndent, 'space-y-px py-0.5')}>
                          {node.models.length === 0 ? (
                            <EmptyHint label="No models" />
                          ) : (
                            node.models.map(model => (
                              <Link
                                key={model.id}
                                href={`/models/${model.id}`}
                                title={model.name}
                                className="group flex w-full items-center gap-1.5 rounded py-1 pl-6 pr-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              >
                                <Package className="h-3 w-3 shrink-0" />
                                <span className="truncate">{model.name}</span>
                                <StatusTag status={model.status} />
                                <ArrowRight
                                  aria-hidden="true"
                                  className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                                />
                              </Link>
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
  )
}
