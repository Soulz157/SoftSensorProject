// components/layout/sidebar/sidebar-footer.tsx
import Link from 'next/link'
import { HelpCircle, LogOut } from 'lucide-react'
import { signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'
import type { SidebarLogic } from '@/hooks/layout/use-sidebar'

interface SidebarFooterProps {
  isCollapsed: boolean
  user: SidebarLogic['user']
  pathname: string
  onClose: () => void
}

export function SidebarFooter({
  isCollapsed,
  user,
  pathname,
  onClose,
}: SidebarFooterProps) {
  return (
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
              {user.initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sidebar-foreground">
                {user.name}
              </p>
              <p className="truncate text-xs text-sidebar-foreground/60">
                {user.email}
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
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Link
            href="/settings?tab=account"
            title="Account Settings"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-80"
          >
            {user.initials}
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
  )
}
