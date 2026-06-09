'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  BarChart3,
  Box,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Cog,
  Database,
  Eye,
  HelpCircle,
  Factory,
  Layers,
  LayoutDashboard,
  LogOut,
  Network,
  PanelLeft,
  PanelLeftClose,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react'
import { useSession, signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useAlertCount } from '@/hooks/workspace/use-alert-count'
import { workspaceIcons, workspaceColors } from '@/store/workspace'
import type { WorkspaceIconProps } from '@/types'
import { Button } from '@/components/ui/button'

// ── Types ────────────────────────────────────────────────────────────────────

interface NavItem {
  id: string
  name: string
  icon: React.ReactNode
  href?: string
  children?: NavItem[]
  badge?: number
}

export interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

// ── Component ────────────────────────────────────────────────────────────────

export function Sidebar({
  isOpen,
  onClose,
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { workspaces } = useWorkspaces()
  const alertCount = useAlertCount()
  const isAdmin = session?.user?.role === 'ADMIN'

  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({})
  const [activeWorkspace, setActiveWorkspace] = useState('')
  const [workspaceOpen, setWorkspaceOpen] = useState(true)

  useEffect(() => {
    setOpenMenus(prev => ({
      ...prev,
      models: prev.models ?? pathname.startsWith('/models'),
      admin: prev.admin ?? pathname.startsWith('/admin'),
    }))
  }, [pathname])

  const currentWorkspace = workspaces.find(w => w.id === activeWorkspace)

  const rawFirstName =
    (session?.user as { firstName?: string } | undefined)?.firstName ?? ''
  const rawLastName =
    (session?.user as { lastName?: string } | undefined)?.lastName ?? ''
  const userName =
    (session?.user?.name ?? `${rawFirstName} ${rawLastName}`.trim()) || 'User'
  const userEmail = session?.user?.email ?? ''
  const initials = getInitials(userName)

  function toggleMenu(id: string) {
    setOpenMenus(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const isActiveNav = (href: string) => {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  const isAnyChildActive = (items: NavItem[]) =>
    items.some(c => c.href && isActiveNav(c.href))

  // ── Nav data ──────────────────────────────────────────────────────────────

  const userNavItems: NavItem[] = [
    {
      id: 'overview',
      name: 'Overview',
      icon: <Factory className="h-4 w-4" />,
      href: '/overview',
    },
    {
      id: 'alerts',
      name: 'Alerts',
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
      children: [
        {
          id: 'models-view',
          name: 'View Model',
          icon: <Eye className="h-4 w-4" />,
          href: '/models',
        },
        {
          id: 'models-deployed',
          name: 'Check Deployed',
          icon: <CheckCircle2 className="h-4 w-4" />,
          href: '/models/deployed',
        },
        {
          id: 'models-quality',
          name: 'Data Quality Check',
          icon: <ClipboardCheck className="h-4 w-4" />,
          href: '/models/quality',
        },
      ],
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

  const adminNavItems: NavItem[] = [
    {
      id: 'admin-dashboard',
      name: 'Admin Dashboard',
      icon: <LayoutDashboard className="h-4 w-4" />,
      href: '/admin/dashboard',
    },
    {
      id: 'admin-users',
      name: 'User Manage',
      icon: <Users className="h-4 w-4" />,
      href: '/admin/users',
    },
    {
      id: 'admin-activity',
      name: 'Activity Log',
      icon: <Activity className="h-4 w-4" />,
      href: '/admin/activity',
    },
    {
      id: 'admin-workspaces',
      name: 'Workspace Manage',
      icon: <Building2 className="h-4 w-4" />,
      href: '/admin/workspaces',
    },
    {
      id: 'admin-settings',
      name: 'System Setting',
      icon: <Cog className="h-4 w-4" />,
      href: '/admin/settings',
    },
  ]

  // ── Renderers ─────────────────────────────────────────────────────────────

  function renderNavItem(item: NavItem) {
    const isDropdown = !!item.children?.length
    const menuOpen = openMenus[item.id] ?? false
    const isAlerting = item.id === 'alerts' && (item.badge ?? 0) > 0

    if (isDropdown) {
      const childActive = isAnyChildActive(item.children!)
      const highlighted = childActive || menuOpen

      return (
        <div key={item.id}>
          <button
            onClick={() => !isCollapsed && toggleMenu(item.id)}
            title={isCollapsed ? item.name : undefined}
            className={cn(
              'flex w-full items-center rounded-md text-sm font-medium transition-all',
              isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
              childActive
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : highlighted
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
            )}
          >
            {item.icon}
            {!isCollapsed && (
              <>
                <span className="flex-1 truncate text-left">{item.name}</span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform duration-200',
                    menuOpen && 'rotate-180',
                  )}
                />
              </>
            )}
          </button>

          {!isCollapsed && menuOpen && (
            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
              {item.children!.map(child => {
                const active = child.href ? isActiveNav(child.href) : false
                return (
                  <Link
                    key={child.id}
                    href={child.href!}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                      active
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    )}
                  >
                    {child.icon}
                    <span className="truncate">{child.name}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    // Leaf item
    const isActive = item.href ? isActiveNav(item.href) : false
    return (
      <Link
        key={item.id}
        href={item.href!}
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
                  'ml-auto flex items-center justify-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold',
                  isAlerting
                    ? 'bg-red-100 text-red-600 dark:border dark:border-red-500/20 dark:bg-red-500/15 dark:text-red-400'
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
  }

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out lg:static',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
          isCollapsed ? 'lg:w-16' : 'lg:w-64',
          'w-64',
        )}
      >
        {/* ── Logo & collapse toggle ── */}
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
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
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

          {/* Desktop: collapse */}
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

          {/* Mobile: close */}
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Expand button when collapsed */}
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

        {/* ── Workspace section ── */}
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
                onClick={() => setWorkspaceOpen(p => !p)}
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
                    isCollapsed && 'justify-center',
                  )}
                >
                  <Building2 className="h-4 w-4 shrink-0" />
                  {!isCollapsed && <span>No workspaces</span>}
                </div>
              ) : (
                workspaces.map(ws => (
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
                      <WorkspaceIcon
                        colorId={ws.color || 'slate'}
                        iconId={ws.icon || 'box'}
                      />
                      {isCollapsed && ws.status && ws.status !== 'normal' && (
                        <span
                          className={cn(
                            'absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-1 ring-sidebar',
                            workspaceStatusDot(ws.status),
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
                            workspaceStatusDot(ws.status),
                          )}
                        />
                        <span className="shrink-0 tabular-nums text-xs text-sidebar-foreground/50">
                          {ws.nodeCount ?? 0}
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

        {/* ── Active workspace context zone ── */}
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
                  aria-label="Clear active workspace"
                  title="Close workspace"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-0.5 font-medium">
                {[
                  {
                    href: `/workspaces/${currentWorkspace.id}/canvas`,
                    icon: <Network className="h-3.5 w-3.5 shrink-0" />,
                    label: 'Pipeline',
                    exact: false,
                  },
                  {
                    href: `/workspaces/${currentWorkspace.id}`,
                    icon: <Database className="h-3.5 w-3.5 shrink-0" />,
                    label: 'Data Manage',
                    exact: true,
                  },
                  {
                    href: `/workspaces/${currentWorkspace.id}/details`,
                    icon: (
                      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                    ),
                    label: 'Setting',
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
                    href="/alerts"
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                      isActiveNav('/alerts')
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

        <div
          className={cn(
            'border-t border-sidebar-border',
            isCollapsed ? 'mx-2' : 'mx-3',
          )}
        />

        {/* ── User navigation ── */}
        <nav
          className={cn(
            'flex-1 overflow-y-auto py-4',
            isCollapsed ? 'px-2' : 'px-3',
          )}
        >
          <div className="space-y-1">{userNavItems.map(renderNavItem)}</div>
        </nav>

        {/* ── Admin section (ADMIN role only) ── */}
        {isAdmin && (
          <>
            <div
              className={cn(
                'border-t border-sidebar-border',
                isCollapsed ? 'mx-2' : 'mx-3',
              )}
            />
            <div className={cn('py-3', isCollapsed ? 'px-2' : 'px-3')}>
              <button
                onClick={() => !isCollapsed && toggleMenu('admin')}
                title={isCollapsed ? 'Admin Panel' : undefined}
                className={cn(
                  'flex w-full items-center rounded-md text-sm font-medium transition-all',
                  isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
                  pathname.startsWith('/admin')
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )}
              >
                <ShieldAlert className="h-4 w-4 shrink-0" />
                {!isCollapsed && (
                  <>
                    <span className="flex-1 text-left">Admin Panel</span>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 transition-transform duration-200',
                        openMenus.admin && 'rotate-180',
                      )}
                    />
                  </>
                )}
              </button>

              {!isCollapsed && openMenus.admin && (
                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
                  {adminNavItems.map(item => {
                    const active = item.href ? isActiveNav(item.href) : false
                    return (
                      <Link
                        key={item.id}
                        href={item.href!}
                        onClick={onClose}
                        className={cn(
                          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                          active
                            ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                        )}
                      >
                        {item.icon}
                        <span className="truncate">{item.name}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Footer ── */}
        <div
          className={cn(
            'border-t border-sidebar-border py-3',
            isCollapsed ? 'px-2' : 'px-3',
          )}
        >
          {!isCollapsed ? (
            <div className="space-y-1">
              <Link
                href="/settings?tab=account"
                onClick={onClose}
                className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-sidebar-accent"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-sidebar-foreground">
                    {userName}
                  </p>
                  <p className="truncate text-xs text-sidebar-foreground/60">
                    {userEmail || 'User'}
                  </p>
                </div>
              </Link>

              <Link
                href="/help"
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  pathname === '/help'
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )}
              >
                <HelpCircle className="h-4 w-4" />
                <span>Help & Support</span>
              </Link>
              {/* 
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <LogOut className="h-4 w-4" />
                <span>Log Out</span>
              </button> */}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Link
                href="/settings?tab=account"
                title="Account Settings"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-80"
              >
                {initials}
              </Link>
              <Link
                href="/help"
                onClick={onClose}
                title="Help & Support"
                className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <HelpCircle className="h-4 w-4" />
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                title="Log Out"
                className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
