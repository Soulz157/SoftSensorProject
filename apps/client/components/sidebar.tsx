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
  CreditCard,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAtomValue } from 'jotai'
import { workspacesAtom } from '@/store/workspace'

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
  const workspaces = useAtomValue(workspacesAtom)
  const currentWorkspace = workspaces.find(w => w.id === activeWorkspace)

  const navItems: NavItem[] = [
    {
      id: 'dashboard',
      name: 'Dashboard',
      icon: <LayoutDashboard className="h-4 w-4" />,
      href: '/dashboard',
    },
    {
      id: 'models',
      name: 'Models',
      icon: <Box className="h-4 w-4" />,
      href: '/models',
      badge: currentWorkspace?.modelsCount,
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

        {/* Collapsed state: expand button at top */}
        {isCollapsed && (
          <div className=" hidden lg:flex justify-center py-3">
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
            <button
              onClick={onWorkspaceToggle}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
            >
              Workspaces
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform duration-200',
                  workspaceOpen && 'rotate-180',
                )}
              />
            </button>
          )}

          {(workspaceOpen || isCollapsed) && (
            <div className={cn('space-y-1', !isCollapsed && 'mt-2')}>
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
                    href={`/workspace/${workspace.id}`}
                    onClick={() => {
                      onWorkspaceChange(workspace.id)
                      onClose()
                    }}
                    title={isCollapsed ? workspace.name : undefined}
                    className={cn(
                      'group flex w-full items-center rounded-md text-sm transition-colors',
                      isCollapsed
                        ? 'justify-center p-2.5'
                        : 'gap-3 px-3 py-2.5',
                      activeWorkspace === workspace.id
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                    )}
                  >
                    <Building2 className="h-4 w-4 shrink-0" />
                    {!isCollapsed && (
                      <>
                        <span className="flex-1 truncate text-left">
                          {workspace.name}
                        </span>
                        <span className="text-xs text-sidebar-foreground/50">
                          {workspace.modelsCount}
                        </span>
                      </>
                    )}
                  </Link>
                ))
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div
          className={cn(
            'border-t border-sidebar-border',
            isCollapsed ? 'mx-2' : 'mx-3',
          )}
        />

        {/* Navigation */}
        <nav className={cn('flex-1 py-4', isCollapsed ? 'px-2' : 'px-3')}>
          <div className="space-y-1">
            {navItems.map(item => (
              <Link
                key={item.id}
                href={item.href}
                onClick={onClose}
                title={isCollapsed ? item.name : undefined}
                className={cn(
                  'flex w-full items-center rounded-md text-sm font-medium transition-colors',
                  isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
                  isActiveNav(item.href)
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )}
              >
                {item.icon}
                {!isCollapsed && (
                  <>
                    <span>{item.name}</span>
                    {item.badge !== undefined && (
                      <span
                        className={cn(
                          'ml-auto rounded-full px-2 py-0.5 text-xs',
                          isActiveNav(item.href)
                            ? 'bg-sidebar-primary-foreground/20 text-sidebar-primary-foreground'
                            : 'bg-sidebar-accent text-sidebar-foreground/60',
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </Link>
            ))}
          </div>
        </nav>

        {/* Upgrade Widget */}
        {currentWorkspace && !isCollapsed && (
          <div className="mx-3 mb-3 rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs font-semibold text-sidebar-foreground">
                  Starter Plan
                </span>
              </div>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                FREE
              </span>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[11px] text-sidebar-foreground/60">
                  Active Models
                </span>
                <span className="text-[11px] font-medium text-sidebar-foreground">
                  4 / 5
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-sidebar-border">
                <div
                  className="h-full rounded-full bg-amber-400 transition-all"
                  style={{ width: '80%' }}
                />
              </div>
            </div>
            <Link
              href="/plans"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Zap className="h-3 w-3" />
              Upgrade Plan
            </Link>
          </div>
        )}

        {/* Collapsed upgrade indicator */}
        {currentWorkspace && isCollapsed && (
          <div className="mx-2 mb-3 flex flex-col items-center gap-1.5">
            <div
              className="h-1.5 w-8 rounded-full bg-sidebar-border overflow-hidden"
              title="4/5 Models — Starter Plan"
            >
              <div
                className="h-full rounded-full bg-amber-400 transition-all"
                style={{ width: '80%' }}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          className={cn(
            'border-t border-sidebar-border py-4',
            isCollapsed ? 'px-2' : 'px-3',
          )}
        >
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
