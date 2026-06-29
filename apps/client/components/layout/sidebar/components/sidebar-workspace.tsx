import Link from 'next/link'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Layers,
  Database,
  Network,
  SlidersHorizontal,
  TriangleAlert,
  X,
  Users2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { workspaceIcons, workspaceColors } from '@/store/workspace'
import type { WorkspaceIconProps } from '@/types'
import { type SidebarLogic } from '@/hooks/layout/use-sidebar'
import Image from 'next/image'

function WorkspaceIcon({ iconId, colorId }: WorkspaceIconProps) {
  const selectedIcon = workspaceIcons.find(item => item.id === iconId)
  const Icon = selectedIcon?.icon
  const selectedColor = workspaceColors.find(item => item.id === colorId)
  const bgClass = selectedColor?.bg || 'bg-slate-500'

  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white ${bgClass}`}
    >
      {Icon ? (
        <Icon className="h-4 w-4" />
      ) : (
        <span>{iconId?.charAt(0)?.toUpperCase() || '?'}</span>
      )}
    </span>
  )
}

interface SidebarWorkspacesProps {
  isCollapsed: boolean
  logic: SidebarLogic
  onClose: () => void
}

export function SidebarWorkspaces({
  isCollapsed,
  logic,
  onClose,
}: SidebarWorkspacesProps) {
  const {
    workspaces,
    failedByWorkspace,
    activeWorkspace,
    setActiveWorkspace,
    workspaceOpen,
    setWorkspaceOpen,
    currentWorkspace,
    pathname,
    isActiveNav,
  } = logic

  return (
    <>
      <div className={cn('py-2', isCollapsed ? 'px-2' : 'px-3')}>
        {!isCollapsed && (
          <div className="flex items-center justify-between rounded-md px-3 py-2">
            <Link
              href="/workspaces"
              onClick={onClose}
              className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
            >
              <Layers className="h-3.5 w-3.5" />
              Workspaces
            </Link>
            <button
              onClick={() => setWorkspaceOpen(!workspaceOpen)}
              className="flex h-5 w-5 items-center justify-center text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform duration-200',
                  workspaceOpen && 'rotate-180',
                )}
              />
            </button>
          </div>
        )}

        {(workspaceOpen || isCollapsed) && (
          <div className={cn(!isCollapsed && 'mt-1')}>
            {workspaces.length === 0 ? (
              <div
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/50',
                  isCollapsed && 'justify-center',
                )}
              >
                <Building2 className="h-4 w-4 shrink-0" />
                {!isCollapsed && <span>No workspaces</span>}
              </div>
            ) : (
              <div className="max-h-60 space-y-1 overflow-y-auto pr-1">
                {workspaces.map(ws => (
                  <Link
                    key={ws.id}
                    href={`/workspaces/${ws.id}`}
                    onClick={() => {
                      setActiveWorkspace(ws.id)
                      onClose()
                    }}
                    title={isCollapsed ? ws.name : undefined}
                    className={cn(
                      'group flex w-full items-center rounded-md text-sm transition-colors',
                      isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2',
                      activeWorkspace === ws.id
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                    )}
                  >
                    <div className="relative shrink-0">
                      {ws.thumbnailUrl ? (
                        <Image
                          src={`${process.env.NEXT_PUBLIC_API_URL}${ws.thumbnailUrl}`}
                          alt={ws.name}
                          width={28}
                          height={28}
                          unoptimized={true}
                          className="h-7 w-7 rounded-lg object-cover"
                        />
                      ) : (
                        <WorkspaceIcon
                          colorId={ws.color || 'slate'}
                          iconId={ws.icon || 'box'}
                        />
                      )}
                      {isCollapsed &&
                        (ws.status !== 'normal' ||
                          (failedByWorkspace[ws.id] ?? 0) > 0) && (
                          <span
                            className={cn(
                              'absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-1 ring-sidebar',
                              'bg-red-500',
                            )}
                          />
                        )}
                    </div>
                    {!isCollapsed && (
                      <>
                        <span className="flex-1 truncate text-left">
                          {ws.name}
                        </span>
                        <span
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            ws.status !== 'normal' ||
                              (failedByWorkspace[ws.id] ?? 0) > 0
                              ? 'bg-red-500'
                              : 'bg-green-500',
                          )}
                        />
                        <span className="shrink-0 tabular-nums text-xs text-sidebar-foreground/50">
                          {ws.nodeCount ?? 0}
                        </span>
                      </>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {!isCollapsed && (
          <div className="px-2 pt-2">
            <Link
              href="/workspaces"
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-muted-foreground/30 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <span>View All Workspaces</span>
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        )}
      </div>

      {/* Active workspace context zone */}
      {!isCollapsed && currentWorkspace && (
        <div className="mx-3 mb-2">
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex min-w-0 items-center gap-2">
                <WorkspaceIcon
                  colorId={currentWorkspace.color || 'slate'}
                  iconId={currentWorkspace.icon || 'box'}
                />
                <span className="truncate text-sm font-semibold text-sidebar-foreground">
                  {currentWorkspace.name}
                </span>
              </div>
              <Button
                variant="outline"
                onClick={() => setActiveWorkspace('')}
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                title="Close workspace"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-0.5 font-medium">
              {[
                {
                  href: `/plants/${currentWorkspace.id}`,
                  icon: <Layers className="h-3.5 w-3.5 shrink-0" />,
                  label: 'Overview',
                  exact: true,
                },
                {
                  href: `/workspaces/${currentWorkspace.id}/canvas`,
                  icon: <Network className="h-3.5 w-3.5 shrink-0" />,
                  label: 'Pipeline',
                  exact: false,
                },
                {
                  href: `/analytics/${currentWorkspace.id}`,
                  icon: <Database className="h-3.5 w-3.5 shrink-0" />,
                  label: 'Data Management',
                  exact: true,
                },
                {
                  href: `/workspaces/${currentWorkspace.id}/details`,
                  icon: <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />,
                  label: 'Workspace Settings',
                  exact: false,
                },
                {
                  href: `/workspaces/${currentWorkspace.id}/members`,
                  icon: <Users2 className="h-3.5 w-3.5 shrink-0" />,
                  label: 'Members / Team',
                  exact: false,
                },
              ].map(link => {
                const active = link.exact
                  ? pathname === link.href
                  : pathname.startsWith(link.href)
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                      active
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    )}
                  >
                    {link.icon}
                    {link.label}
                  </Link>
                )
              })}

              {(currentWorkspace.alarmCount ?? 0) > 0 && (
                <Link
                  href={`/workspaces/${currentWorkspace.id}/alerts`}
                  onClick={onClose}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                    isActiveNav(`/workspaces/${currentWorkspace.id}/alerts`)
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-destructive/70 hover:bg-destructive/10 hover:text-destructive',
                  )}
                >
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Alerts</span>
                  <span className="ml-auto flex items-center gap-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600 dark:border dark:border-red-500/20 dark:bg-red-500/15 dark:text-red-400">
                    <TriangleAlert className="h-3.5 w-3.5 animate-pulse" />
                    {currentWorkspace.alarmCount}
                  </span>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
