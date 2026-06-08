'use client'
import { cn } from '@/lib/utils'
import { workspaceColors, workspaceIcons } from '@/store/workspace'
import type { Workspace } from '@/types'
import type { NodeStatus } from './machines/status-colors'

const STATUS_DOT: Record<NonNullable<Workspace['status']>, string> = {
  alarm: 'bg-red-500 shadow-[0_0_6px_#ef4444]',
  warning: 'bg-amber-500 shadow-[0_0_6px_#f59e0b]',
  normal: 'bg-emerald-500',
  offline: 'bg-zinc-500',
}

const FILTER_ITEMS: { status: NodeStatus; label: string; dotClass: string }[] =
  [
    { status: 'alarm', label: 'Alarm', dotClass: 'bg-red-500' },
    { status: 'warning', label: 'Warning', dotClass: 'bg-amber-500' },
    { status: 'normal', label: 'Normal', dotClass: 'bg-emerald-500' },
  ]

interface WorkspaceSidebarProps {
  workspaces: Workspace[]
  selectedWorkspaceId: string | null
  onSelectWorkspace: (id: string) => void
  statusFilter: NodeStatus | null
  onStatusFilter: (status: NodeStatus | null) => void
}

export function WorkspaceSidebar({
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
  statusFilter,
  onStatusFilter,
}: WorkspaceSidebarProps) {
  const alarmCount = workspaces.reduce(
    (sum, ws) => sum + (ws.alarmCount ?? 0),
    0,
  )

  return (
    <aside className="flex w-40 shrink-0 flex-col border-r border-border bg-[#0a0d14]">
      <div className="px-3 pb-1 pt-3 text-[8px] font-semibold uppercase tracking-widest text-muted-foreground/50">
        Workspaces
      </div>

      <div className="flex flex-col">
        {workspaces.map(ws => {
          const accentBg =
            workspaceColors.find(c => c.id === ws.color)?.bg ?? 'bg-blue-500'
          const IconComp = workspaceIcons.find(i => i.id === ws.icon)?.icon
          const isActive = selectedWorkspaceId === ws.id
          const dotClass = ws.status ? STATUS_DOT[ws.status] : 'bg-zinc-500'

          return (
            <div
              key={ws.id}
              data-ws={ws.id}
              onClick={() => onSelectWorkspace(ws.id)}
              className={cn(
                'flex cursor-pointer items-center gap-2 border-l-2 px-3 py-1.5 transition-colors',
                isActive
                  ? 'border-primary bg-primary/8'
                  : 'border-transparent hover:bg-muted/20',
              )}
            >
              <div
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px]',
                  accentBg,
                  'bg-opacity-20',
                )}
              >
                {IconComp && <IconComp className="h-3 w-3" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-semibold text-foreground/80">
                  {ws.name}
                </div>
                <div className="text-[8px] text-muted-foreground">
                  {ws.nodeCount ?? 0} devices
                </div>
              </div>
              <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)} />
            </div>
          )
        })}
      </div>

      <div className="mx-3 my-2 border-t border-border" />
      <div className="px-3 pb-1 text-[8px] text-muted-foreground/50">
        Filter by Status
      </div>

      {FILTER_ITEMS.map(({ status, label, dotClass }) => {
        const count = status === 'alarm' ? alarmCount : undefined
        const isActive = statusFilter === status
        return (
          <button
            key={status}
            onClick={() => onStatusFilter(isActive ? null : status)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-left text-[9px] transition-colors',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground/70',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
            {label}
            {count !== undefined && count > 0 && (
              <span className="ml-auto text-[8px] text-destructive">
                ({count})
              </span>
            )}
          </button>
        )
      })}

      <div className="flex-1" />
    </aside>
  )
}
