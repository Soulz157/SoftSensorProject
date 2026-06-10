'use client'

import { cn } from '@/lib/utils'
import { SidebarHeader } from './components/sidebar-header'
import { SidebarWorkspaces } from './components/sidebar-workspace'
import { SidebarNav } from './components/sidebar-nav'
import { SidebarFooter } from './components/sidebar-footer'
import { getUserNavItems, adminNavItems } from './config'
import { SidebarProps } from './types'
import { useSidebar } from '@/hooks/layout/use-sidebar'

export function Sidebar({
  isOpen,
  onClose,
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  const logic = useSidebar()
  const userNavItems = getUserNavItems(logic.alertCount)

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
        <SidebarHeader
          isCollapsed={isCollapsed}
          onToggleCollapse={onToggleCollapse}
          onClose={onClose}
        />

        <SidebarWorkspaces
          isCollapsed={isCollapsed}
          logic={logic}
          onClose={onClose}
        />

        <div
          className={cn(
            'border-t border-sidebar-border',
            isCollapsed ? 'mx-2' : 'mx-3',
          )}
        />

        <SidebarNav
          items={userNavItems}
          isCollapsed={isCollapsed}
          logic={logic}
          onClose={onClose}
        />

        {logic.isAdmin && (
          <SidebarNav
            title="Admin Panel"
            items={adminNavItems}
            isCollapsed={isCollapsed}
            logic={logic}
            onClose={onClose}
          />
        )}

        <SidebarFooter
          isCollapsed={isCollapsed}
          user={logic.user}
          pathname={logic.pathname}
          onClose={onClose}
        />
      </aside>
    </>
  )
}
