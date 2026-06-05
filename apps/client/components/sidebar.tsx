'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Settings,
  HelpCircle,
  ChevronDown,
  Building2,
  Box,
  BarChart3,
  X,
  PanelLeftClose,
  PanelLeft,
  ShieldAlert,
  Layers,
  TriangleAlert,
  Network,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession } from 'next-auth/react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useAlertCount } from '@/hooks/workspace/use-alert-count'
import { WorkspaceIconProps } from '@/types'
import { workspaceIcons, workspaceColors } from '@/store/workspace'
import { Button } from './ui/button'

interface NavItem {
  id: string
  name: string
  icon: React.ReactNode
  href: string
  badge?: number
}

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  activeWorkspace: string
  onWorkspaceChange: (id: string) => void
  workspaceOpen: boolean
  onWorkspaceToggle: () => void
}

function workspaceStatusDot(status?: string): string {
  switch (status) {
    case 'alarm':
      return 'bg-red-500'
    case 'warning':
      return 'bg-amber-500'
    case 'offline':
      return 'bg-zinc-500'
    default:
      return 'bg-emerald-500'
  }
}

function WorkspaceIcon({ iconId, colorId }: WorkspaceIconProps) {
  const selectedIcon = workspaceIcons.find(item => item.id === iconId)
  const Icon = selectedIcon?.icon
  const selectedColor = workspaceColors.find(item => item.id === colorId)
  const bgClass = selectedColor?.bg || 'bg-slate-500'

  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white text-xs font-semibold ${bgClass}`}
    >
      {Icon ? (
        <Icon className="h-4 w-4" />
      ) : (
        <span>{iconId?.charAt(0)?.toUpperCase() || '?'}</span>
      )}
    </span>
  )
}

export function Sidebar({
  isOpen,
  onClose,
  isCollapsed,
  onToggleCollapse,
  activeWorkspace,
  onWorkspaceChange,
  workspaceOpen,
  onWorkspaceToggle,
}: SidebarProps) {
  const pathname = usePathname()
  const { workspaces } = useWorkspaces()
  const currentWorkspace = workspaces.find(w => w.id === activeWorkspace)
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'ADMIN'
  const alertCount = useAlertCount()

  const onClearWorkspace = () => {
    onWorkspaceChange('')
  }

  const navItems: NavItem[] = [
    {
      id: 'dashboard',
      name: 'Dashboard',
      icon: <LayoutDashboard className="h-4 w-4" />,
      href: '/dashboard',
    },
    {
      id: 'alerts',
      name: 'Alerts',
      // เพิ่ม animate-pulse ตรงนี้เพื่อให้ไอคอนใน Sidebar หลักกระพริบตอนมี Alert
      icon: (
        <TriangleAlert
          className={cn('h-4 w-4', alertCount > 0 && 'animate-pulse')}
        />
      ),
      href: '/alerts',
      badge: alertCount > 0 ? alertCount : undefined,
    },
    {
      id: 'models',
      name: 'Models',
      icon: <Box className="h-4 w-4" />,
      href: '/models',
    },
    {
      id: 'analytics',
      name: 'Analytics',
      icon: <BarChart3 className="h-4 w-4" />,
      href: '/analytics',
    },
    {
      id: 'settings',
      name: 'Settings',
      icon: <Settings className="h-4 w-4" />,
      href: '/settings',
    },
  ]

  const isActiveNav = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-screen flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-300 ease-in-out lg:static',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
          isCollapsed ? 'lg:w-16' : 'lg:w-64',
          'w-64',
        )}
      >
        {/* Logo & Collapse Toggle */}
        <div
          className={cn(
            'flex items-center border-b border-sidebar-border transition-all',
            isCollapsed
              ? 'justify-center px-2 py-4'
              : 'justify-between px-4 py-4',
          )}
        >
          <Link
            href="/"
            className={cn(
              'flex items-center gap-3',
              isCollapsed && 'lg:justify-center',
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shrink-0">
              <Box className="h-4 w-4 text-primary-foreground" />
            </div>
            <span
              className={cn(
                'text-lg font-semibold tracking-tight transition-opacity',
                isCollapsed ? 'lg:hidden' : 'lg:block',
              )}
            >
              SoftSensor
            </span>
          </Link>

          {/* Desktop collapse toggle */}
          <button
            onClick={onToggleCollapse}
            className={cn(
              'hidden cursor-pointer lg:flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors',
              isCollapsed && 'lg:hidden',
            )}
            title="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>

          {/* Mobile close button */}
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Collapsed state: expand button */}
        {isCollapsed && (
          <div className="hidden lg:flex justify-center py-3">
            <button
              onClick={onToggleCollapse}
              className="cursor-pointer flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              title="Expand sidebar"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Workspace Section */}
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
                onClick={onWorkspaceToggle}
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
            <div className={cn('space-y-1', !isCollapsed && 'mt-1')}>
              {workspaces.length === 0 ? (
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/50',
                    isCollapsed ? 'justify-center' : '',
                  )}
                >
                  <Building2 className="h-4 w-4 shrink-0" />
                  {!isCollapsed && <span>No workspaces</span>}
                </div>
              ) : (
                workspaces.map(workspace => (
                  <Link
                    key={workspace.id}
                    href={`/workspaces/${workspace.id}`}
                    onClick={() => {
                      onWorkspaceChange(workspace.id)
                      onClose()
                    }}
                    title={isCollapsed ? workspace.name : undefined}
                    className={cn(
                      'group w-full flex items-center rounded-md text-sm transition-colors',
                      isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2',
                      activeWorkspace === workspace.id
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                    )}
                  >
                    <div className="relative shrink-0">
                      <WorkspaceIcon
                        colorId={workspace.color || 'slate'}
                        iconId={workspace.icon || 'box'}
                      />
                      {isCollapsed &&
                        workspace.status &&
                        workspace.status !== 'normal' && (
                          <span
                            className={cn(
                              'absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-sidebar',
                              workspaceStatusDot(workspace.status),
                            )}
                          />
                        )}
                    </div>
                    {!isCollapsed && (
                      <>
                        <span className="flex-1 truncate text-left">
                          {workspace.name}
                        </span>
                        <span
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            workspaceStatusDot(workspace.status),
                          )}
                        />
                        <span className="text-xs text-sidebar-foreground/50 shrink-0 tabular-nums">
                          {workspace.nodeCount ?? 0}
                        </span>
                      </>
                    )}
                  </Link>
                ))
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

        {/* Active Workspace Context Zone */}
        {!isCollapsed && currentWorkspace && (
          <div className="mx-3 mb-2">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-2">
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-2 min-w-0">
                  <WorkspaceIcon
                    colorId={currentWorkspace.color || 'slate'}
                    iconId={currentWorkspace.icon || 'box'}
                  />
                  <span className="text-sm font-semibold text-sidebar-foreground truncate">
                    {currentWorkspace.name}
                  </span>
                </div>

                <Button
                  variant={'outline'}
                  onClick={onClearWorkspace}
                  className="cursor-pointer flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  aria-label="Clear active workspace"
                  title="Close Workspace"
                >
                  <X className="h-4 w-4" />{' '}
                </Button>
              </div>

              {/* Navigation Links */}
              <div className="space-y-0.5 font-medium">
                <Link
                  href={`/workspaces/${currentWorkspace.id}/canvas`}
                  onClick={onClose}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                    isActiveNav(`/workspaces/${currentWorkspace.id}/canvas`)
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  )}
                >
                  <Network className="h-3.5 w-3.5 shrink-0" />
                  Canvas
                </Link>
                <Link
                  href={`/workspaces/${currentWorkspace.id}`}
                  onClick={onClose}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                    pathname === `/workspaces/${currentWorkspace.id}`
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  )}
                >
                  <Box className="h-3.5 w-3.5 shrink-0" />
                  Models
                </Link>
                <Link
                  href="/alerts"
                  onClick={onClose}
                  className={cn(
                    ' flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors text-muted-foreground',
                    isActiveNav('/alerts')
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-destructive/70 hover:bg-destructive/10 hover:text-destructive',
                  )}
                >
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text">Alerts</span>
                  {(currentWorkspace.alarmCount ?? 0) > 0 && (
                    <span className="ml-auto flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold transition-colors bg-red-100 text-red-600  dark:bg-red-500/15 dark:text-red-400 dark:border dark:border-red-500/20">
                      <TriangleAlert className="h-3.5 w-3.5 animate-pulse" />
                      <span>{currentWorkspace.alarmCount}</span>
                    </span>
                  )}
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Divider */}
        <div
          className={cn(
            'border-t border-sidebar-border',
            isCollapsed ? 'mx-2' : 'mx-3',
          )}
        />

        <nav className={cn('flex-1 py-4', isCollapsed ? 'px-2' : 'px-3')}>
          <div className="space-y-1">
            {navItems.map(item => {
              const isActive = isActiveNav(item.href)
              const isAlerting = item.id === 'alerts' && (item.badge ?? 0) > 0

              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={onClose}
                  title={isCollapsed ? item.name : undefined}
                  className={cn(
                    'flex w-full items-center rounded-md text-sm font-medium transition-all',
                    isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',

                    isAlerting && !isActive
                      ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20'
                      : isActive
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  )}
                >
                  {item.icon}
                  {!isCollapsed && (
                    <>
                      <span className="truncate">{item.name}</span>
                      {item.badge !== undefined && (
                        <span
                          className={cn(
                            'ml-auto flex items-center justify-center rounded-full px-2 py-0.5 gap-1.5 text-xs font-semibold',
                            isAlerting
                              ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400 dark:border dark:border-red-500/20'
                              : isActive
                                ? 'bg-sidebar-primary-foreground/20 text-sidebar-primary-foreground'
                                : 'bg-primary/10 text-primary dark:bg-primary/20',
                          )}
                        >
                          <TriangleAlert className="h-3.5 w-3.5 animate-pulse" />
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              )
            })}
          </div>
        </nav>

        {/* Footer */}
        <div
          className={cn(
            'border-t border-sidebar-border py-4',
            isCollapsed ? 'px-2' : 'px-3',
          )}
        >
          {isAdmin && (
            <Link
              href="/admin"
              onClick={onClose}
              title={isCollapsed ? 'Admin Panel' : undefined}
              className={cn(
                'flex w-full items-center rounded-md text-sm transition-colors mb-1',
                isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2',
                pathname.startsWith('/admin')
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                  : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground',
              )}
            >
              <ShieldAlert className="h-4 w-4" />
              {!isCollapsed && <span>Admin Panel</span>}
            </Link>
          )}
          <Link
            href="/help"
            onClick={onClose}
            title={isCollapsed ? 'Help & Support' : undefined}
            className={cn(
              'flex w-full items-center rounded-md text-sm transition-colors',
              isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2',
              pathname === '/help'
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground',
            )}
          >
            <HelpCircle className="h-4 w-4" />
            {!isCollapsed && <span>Help & Support</span>}
          </Link>
        </div>
      </aside>
    </>
  )
}
