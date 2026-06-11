'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Power,
  Settings2,
  Siren,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasNode } from '@/services/canvas'
import type { WorkspacePlant } from '@/types'
import type { NodeStatus } from '../../../../../store/status-colors'

const NODE_PRIORITY: Record<NodeStatus, number> = {
  alarm: 0,
  warning: 1,
  offline: 2,
  normal: 3,
}

const DEPLOY_DOT: Record<string, string> = {
  running: 'bg-emerald-500',
  initializing: 'bg-blue-400',
  stopped: 'bg-zinc-400',
  failed: 'bg-red-500',
}

const DEPLOY_LABEL: Record<string, string> = {
  running: 'text-emerald-500',
  initializing: 'text-blue-400',
  stopped: 'text-muted-foreground',
  failed: 'text-red-500',
}

const MAX_PREVIEW = 5

const STATUS_CHIP: Record<NodeStatus, string> = {
  normal: 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-500',
  warning: 'border border-amber-500/30 bg-amber-500/15 text-amber-500',
  alarm: 'border border-red-500/30 bg-red-500/15 text-red-500',
  offline: 'border border-zinc-500/30 bg-zinc-500/15 text-zinc-400',
}

const STATUS_DOT: Record<NodeStatus, string> = {
  normal: 'bg-emerald-500',
  warning: 'bg-amber-500',
  alarm: 'bg-red-500',
  offline: 'bg-zinc-500',
}

const STATUS_ICON = {
  normal: CheckCircle2,
  warning: AlertTriangle,
  alarm: Siren,
  offline: Power,
} satisfies Record<NodeStatus, typeof CheckCircle2>

interface NodeDetailPanelProps {
  viewMode: 'plants' | 'equipment'
  node: CanvasNode | null
  plan: WorkspacePlant | null
  planNodes?: CanvasNode[]
  workspaceId: string | null
  onDrillDown?: (planId: string) => void
  onEditClick?: (node: CanvasNode) => void
  isOpen: boolean
  onClose: () => void
}

function formatStatus(status: NodeStatus) {
  if (status === 'normal') return 'Healthy'
  if (status === 'alarm') return 'Alert'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString()
}

function PrimaryPanelButton({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center rounded-md bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
    >
      {children}
    </button>
  )
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors lg:hidden"
      aria-label="Close panel"
    >
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5 fill-current">
        <path
          d="M1 1l12 12M13 1L1 13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </button>
  )
}

function EmptyInspector({
  title,
  description,
  isOpen,
  onClose,
}: {
  title: string
  description: string
  isOpen: boolean
  onClose: () => void
}) {
  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          'flex flex-col border-l border-border bg-card/90 backdrop-blur-xl',
          'fixed inset-y-0 right-0 z-50 w-80 shadow-2xl transition-transform duration-300',
          'lg:relative lg:inset-auto lg:z-auto lg:w-72 lg:shadow-none lg:shrink-0 lg:translate-x-0',
          isOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0',
          'items-center justify-center p-6 text-center',
        )}
      >
        <CloseButton onClick={onClose} />
        <Cpu className="mb-3 h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </aside>
    </>
  )
}

export function NodeDetailPanel({
  viewMode,
  node,
  plan,
  planNodes,
  workspaceId,
  onDrillDown,
  onEditClick,
  isOpen,
  onClose,
}: NodeDetailPanelProps) {
  if (viewMode === 'plants') {
    if (!plan) {
      return (
        <EmptyInspector
          title="Select a plant or equipment"
          description="Choose a plant zone for summary data or select equipment to open its Canvas."
          isOpen={isOpen}
          onClose={onClose}
        />
      )
    }

    const planStatus = (plan.status ?? 'normal') as NodeStatus

    return (
      <>
        {isOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={onClose}
          />
        )}
        <aside
          className={cn(
            'flex flex-col border-l border-border bg-card/90 backdrop-blur-xl',
            'fixed inset-y-0 right-0 z-50 w-80 shadow-2xl transition-transform duration-300 overflow-y-auto',
            'lg:relative lg:inset-auto lg:z-auto lg:w-72 lg:shadow-none lg:shrink-0 lg:translate-x-0 lg:overflow-y-visible',
            isOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0',
          )}
        >
          <CloseButton onClick={onClose} />
          <div className="border-b border-border bg-muted/20 px-4 py-4">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Plant Inspector
            </div>
            <div className="mb-3 text-base font-bold text-foreground">
              {plan.name}
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                STATUS_CHIP[planStatus],
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  STATUS_DOT[planStatus],
                )}
              />
              {formatStatus(planStatus)}
            </span>
          </div>

          <div className="border-b border-border/50 px-4 py-4">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Equipment Summary
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Total Nodes</p>
                <p className="text-lg font-bold text-foreground">
                  {plan.nodeCount ?? 0}
                </p>
              </div>
              <div className="rounded-md bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Alerts</p>
                <p className="text-lg font-bold text-red-500">
                  {plan.alarmCount ?? 0}
                </p>
              </div>
            </div>
          </div>

          {planNodes && planNodes.length > 0 && workspaceId && (
            <div className="border-b border-border/50 px-4 py-4">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Equipment
              </div>
              <div className="space-y-0.5">
                {[...planNodes]
                  .sort(
                    (a, b) =>
                      (NODE_PRIORITY[a.data.status] ?? 3) -
                      (NODE_PRIORITY[b.data.status] ?? 3),
                  )
                  .slice(0, MAX_PREVIEW)
                  .map(n => {
                    const st = n.data.status as NodeStatus
                    return (
                      <Link
                        key={n.id}
                        href={`/workspaces/${workspaceId}/canvas`}
                        className="group flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
                      >
                        <span
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            STATUS_DOT[st],
                            st === 'alarm' &&
                              'ring-4 ring-red-500/20 motion-safe:animate-pulse',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">
                            {n.data.name}
                          </p>
                          <p className="text-[10px] capitalize text-muted-foreground">
                            {n.data.type}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 text-[10px] font-semibold',
                            STATUS_CHIP[st]
                              .split(' ')
                              .find(c => c.startsWith('text-')) ?? '',
                          )}
                        >
                          {formatStatus(st)}
                        </span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    )
                  })}
              </div>
              {planNodes.length > MAX_PREVIEW && (
                <Link
                  href={`/workspaces/${workspaceId}/canvas`}
                  className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  View all {planNodes.length} equipment
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          )}

          {plan.description && (
            <div className="border-b border-border/50 px-4 py-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Description
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {plan.description}
              </p>
            </div>
          )}

          <div className="mt-auto space-y-2 px-4 py-4">
            <PrimaryPanelButton onClick={() => onDrillDown?.(plan.id)}>
              View Equipment
            </PrimaryPanelButton>
            {workspaceId && (
              <Link
                href={`/workspaces/${workspaceId}/canvas`}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                View Pipeline
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </aside>
      </>
    )
  }

  if (!node) {
    return (
      <EmptyInspector
        title="Select a device"
        description="Click an equipment node on the map or grid to inspect its status."
        isOpen={isOpen}
        onClose={onClose}
      />
    )
  }

  const status = node.data.status as NodeStatus
  const StatusIcon = STATUS_ICON[status]

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          'flex flex-col border-l border-border bg-card/90 backdrop-blur-xl',
          'fixed inset-y-0 right-0 z-50 w-80 shadow-2xl transition-transform duration-300 overflow-y-auto',
          'lg:relative lg:inset-auto lg:z-auto lg:w-72 lg:shadow-none lg:shrink-0 lg:translate-x-0 lg:overflow-y-visible',
          isOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0',
        )}
      >
        <CloseButton onClick={onClose} />
        <div className="border-b border-border bg-muted/20 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Cpu className="h-3.5 w-3.5 text-primary" />
                Equipment Inspector
              </div>
              <div className="truncate text-base font-bold text-foreground">
                {node.data.name}
              </div>
              <div className="text-xs capitalize text-muted-foreground">
                {node.data.type} Node
              </div>
            </div>
            {onEditClick && (
              <button
                type="button"
                onClick={() => onEditClick(node)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Edit Device Settings"
              >
                <Settings2 className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-border bg-background/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Real-time status
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                  STATUS_CHIP[status],
                )}
              >
                <StatusIcon className="h-3.5 w-3.5" />
                {formatStatus(status)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  STATUS_DOT[status],
                  status === 'alarm' && 'animate-pulse',
                )}
              />
              Semantic status from live node data
            </div>
          </div>
        </div>

        <div className="border-b border-border/50 px-4 py-4">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Metrics
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">AI Models</p>
              <p className="text-lg font-bold text-foreground">
                {node.models.length}
              </p>
            </div>
            <div className="rounded-md bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Node Type</p>
              <p className="truncate text-sm font-semibold capitalize text-foreground">
                {node.data.type}
              </p>
            </div>
          </div>
        </div>

        <div className="border-b border-border/50 px-4 py-4">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            AI Models
          </div>
          {node.models.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              No models assigned
            </p>
          ) : (
            <div className="space-y-1">
              {node.models.map(model => {
                const deploy =
                  (model.data?.deployStatus as string | undefined) ?? null
                return (
                  <Link
                    key={model.id}
                    href={`/models/${model.id}`}
                    className="group flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 transition-colors hover:bg-accent/50"
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        deploy
                          ? (DEPLOY_DOT[deploy] ?? 'bg-emerald-500')
                          : 'bg-emerald-500',
                      )}
                    />
                    <span className="flex-1 truncate text-xs font-medium text-foreground">
                      {model.name}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] capitalize',
                        deploy
                          ? (DEPLOY_LABEL[deploy] ?? 'text-emerald-500')
                          : 'text-emerald-500',
                      )}
                    >
                      {deploy ?? 'active'}
                    </span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-b border-border/50 px-4 py-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Last Updated
          </div>
          <div className="text-xs text-muted-foreground">
            {formatDate(node.updatedAt)}
          </div>
        </div>

        <div className="mt-auto space-y-2 px-4 py-4">
          {workspaceId && (
            <Link
              href={`/workspaces/${workspaceId}/canvas?nodeId=${node.id}`}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              View Pipeline
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
          <button
            type="button"
            className="block w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={status === 'normal' || status === 'offline'}
          >
            Acknowledge Alarm
          </button>
        </div>
      </aside>
    </>
  )
}
