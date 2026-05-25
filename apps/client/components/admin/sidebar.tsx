'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Building2,
  Activity,
  Settings,
  X,
  PanelLeftClose,
  PanelLeft,
  ShieldAlert,
  LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession, signOut } from 'next-auth/react'

interface NavItem {
  id: string
  name: string
  icon: React.ReactNode
  href: string
}

interface AdminSidebarProps {
  isOpen: boolean
  onClose: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}

const adminNavItems: NavItem[] = [
  {
    id: 'overview',
    name: 'Overview',
    icon: <LayoutDashboard className="h-4 w-4" />,
    href: '/admin',
  },
  {
    id: 'users',
    name: 'User Management',
    icon: <Users className="h-4 w-4" />,
    href: '/admin/users',
  },
  {
    id: 'workspaces',
    name: 'Workspaces',
    icon: <Building2 className="h-4 w-4" />,
    href: '/admin/workspaces',
  },
  {
    id: 'activity',
    name: 'Activity Logs',
    icon: <Activity className="h-4 w-4" />,
    href: '/admin/activity',
  },
  {
    id: 'settings',
    name: 'System Settings',
    icon: <Settings className="h-4 w-4" />,
    href: '/admin/settings',
  },
]

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function AdminSidebar({
  isOpen,
  onClose,
  isCollapsed,
  onToggleCollapse,
}: AdminSidebarProps) {
  const pathname = usePathname()
  const { data: session } = useSession()

  const isActiveNav = (href: string, id: string) => {
    if (id === 'overview') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  const userName =
    (session?.user?.name ??
      `${(session?.user as { firstName?: string } | undefined)?.firstName ?? ''} ${(session?.user as { lastName?: string } | undefined)?.lastName ?? ''}`.trim()) ||
    'Admin'
  const userEmail = session?.user?.email ?? ''
  const initials = getInitials(userName || 'A')

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
            href="/admin"
            className={cn(
              'flex items-center gap-3',
              isCollapsed && 'lg:justify-center',
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shrink-0">
              <ShieldAlert className="h-4 w-4 text-primary-foreground" />
            </div>
            <span
              className={cn(
                'text-lg font-semibold tracking-tight transition-opacity',
                isCollapsed ? 'lg:hidden' : 'lg:block',
              )}
            >
              Admin Panel
            </span>
          </Link>

          {/* Desktop collapse toggle */}
          {!isCollapsed && (
            <button
              onClick={onToggleCollapse}
              className="hidden cursor-pointer lg:flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}

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

        {/* Navigation */}
        <nav className={cn('flex-1 py-4', isCollapsed ? 'px-2' : 'px-3')}>
          <div className="space-y-1">
            {adminNavItems.map(item => (
              <Link
                key={item.id}
                href={item.href}
                onClick={onClose}
                title={isCollapsed ? item.name : undefined}
                className={cn(
                  'flex w-full items-center rounded-md text-sm font-medium transition-colors',
                  isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
                  isActiveNav(item.href, item.id)
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )}
              >
                {item.icon}
                {!isCollapsed && <span>{item.name}</span>}
              </Link>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div
          className={cn(
            'border-t border-sidebar-border py-4',
            isCollapsed ? 'px-2' : 'px-3',
          )}
        >
          {!isCollapsed ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 px-3 py-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-sidebar-foreground">
                    {userName}
                  </p>
                  <p className="truncate text-xs text-sidebar-foreground/60">
                    {userEmail || 'Administrator'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              >
                <LogOut className="h-4 w-4" />
                <span>Log Out</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                title={userName}
              >
                {initials}
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                title="Log Out"
                className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
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
