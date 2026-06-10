// components/layout/sidebar/sidebar-header.tsx
import Link from 'next/link'
import { Box, PanelLeftClose, PanelLeft, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarHeaderProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  onClose: () => void
}

export function SidebarHeader({
  isCollapsed,
  onToggleCollapse,
  onClose,
}: SidebarHeaderProps) {
  return (
    <>
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
    </>
  )
}
