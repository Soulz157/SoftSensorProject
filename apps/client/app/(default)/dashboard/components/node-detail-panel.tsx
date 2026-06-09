'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Settings2 } from 'lucide-react'
import type { CanvasNode } from '@/services/canvas'
import type { WorkspacePlan } from '@/types'
import type { NodeStatus } from '../../../../store/status-colors'

const STATUS_CHIP: Record<NodeStatus, string> = {
  normal: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  alarm: 'bg-red-500/15 text-red-400 border border-red-500/30',
  offline: 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30',
}

interface NodeDetailPanelProps {
  viewMode: 'plans' | 'equipment'
  node: CanvasNode | null
  plan: WorkspacePlan | null
  workspaceId: string | null
  onDrillDown?: (planId: string) => void
  onEditClick?: (node: CanvasNode) => void
}

export function NodeDetailPanel({
  viewMode,
  node,
  plan,
  workspaceId,
  onDrillDown,
  onEditClick,
}: NodeDetailPanelProps) {
  if (viewMode === 'plans') {
    if (!plan) {
      return (
        <aside className="flex w-50 shrink-0 flex-col items-center justify-center border-l border-border bg-[#0a0d14] text-center">
          <p className="text-[11px] text-muted-foreground/40">
            Select a plan on the map
          </p>
        </aside>
      )
    }

    const planStatus = (plan.status ?? 'normal') as NodeStatus

    return (
      <aside className="flex w-50 shrink-0 flex-col border-l border-border bg-[#0a0d14]">
        <div className="border-b border-border bg-[#0d1018] px-3.5 py-3">
          <div className="mb-0.5 text-[9px] text-muted-foreground/50">
            WORKSPACE PLAN
          </div>
          <div className="mb-2 text-sm font-bold text-foreground">
            {plan.name}
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase',
              STATUS_CHIP[planStatus],
            )}
          >
            {planStatus}
          </span>
        </div>

        <div className="border-b border-border/50 px-3.5 py-2.5">
          <div className="mb-1.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            Equipment Summary
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-[9px] text-muted-foreground">Total</span>
            <span className="text-[9px] font-semibold text-foreground">
              {plan.nodeCount ?? 0}
            </span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-[9px] text-muted-foreground">Alerts</span>
            <span className="text-[9px] font-semibold text-red-400">
              {plan.alarmCount ?? 0}
            </span>
          </div>
        </div>

        {plan.description && (
          <div className="border-b border-border/50 px-3.5 py-2.5">
            <div className="mb-1 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/40">
              Description
            </div>
            <p className="text-[9px] text-muted-foreground">
              {plan.description}
            </p>
          </div>
        )}

        <div className="mt-auto px-3.5 py-3">
          <button
            onClick={() => onDrillDown?.(plan.id)}
            className="block w-full rounded-md bg-primary py-2 text-center text-[10px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            View Equipment →
          </button>
        </div>
      </aside>
    )
  }

  if (!node) {
    return (
      <aside className="flex w-50 shrink-0 flex-col items-center justify-center border-l border-border bg-[#0a0d14] text-center">
        <p className="text-[11px] text-muted-foreground/40">
          Select a device on the map
        </p>
      </aside>
    )
  }

  const status = node.data.status as NodeStatus

  return (
    <aside className="flex w-50 shrink-0 flex-col border-l border-border bg-[#0a0d14]">
      <div className="border-b border-border bg-[#0d1018] px-3.5 py-3">
        <div className="flex items-start justify-between">
          <div className="mb-0.5 text-[9px] text-muted-foreground/50">
            {node.data.type}
          </div>
          {onEditClick && (
            <button
              onClick={() => onEditClick(node)}
              className="text-muted-foreground/50 transition-colors hover:text-foreground"
              title="Edit Device Settings"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="mb-2 text-sm font-bold text-foreground">
          {node.data.name}
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase',
            STATUS_CHIP[status],
          )}
        >
          {status}
        </span>
      </div>

      <div className="border-b border-border/50 px-3.5 py-2.5">
        <div className="mb-1.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/40">
          AI Models
        </div>
        {node.models.length === 0 ? (
          <p className="text-[9px] text-muted-foreground/30">
            No models assigned
          </p>
        ) : (
          node.models.map(model => (
            <div key={model.id} className="flex items-center gap-1.5 py-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="flex-1 truncate text-[9px] text-muted-foreground">
                {model.name}
              </span>
              <span className="text-[8px] text-emerald-400">active</span>
            </div>
          ))
        )}
      </div>

      <div className="border-b border-border/50 px-3.5 py-2.5">
        <div className="mb-1 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/40">
          Last Updated
        </div>
        <div className="text-[9px] text-muted-foreground">
          {new Date(node.updatedAt).toLocaleString()}
        </div>
      </div>

      <div className="mt-auto px-3.5 py-3">
        {workspaceId && (
          <Link
            href={`/workspaces/${workspaceId}/canvas`}
            className="mb-1.5 block rounded-md bg-primary py-2 text-center text-[10px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            View Details →
          </Link>
        )}
        <button
          className="block w-full rounded-md border border-border bg-muted/20 py-1.5 text-center text-[9px] text-muted-foreground transition-colors hover:text-foreground"
          disabled={status === 'normal' || status === 'offline'}
        >
          Acknowledge Alarm
        </button>
      </div>
    </aside>
  )
}
