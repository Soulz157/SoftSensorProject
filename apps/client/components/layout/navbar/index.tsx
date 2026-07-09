// components/layout/navbar/index.tsx
'use client'

import Link from 'next/link'
import { Menu, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { NavbarProps } from './types'
import { NavbarSkeleton } from './components/skeleton'
import { useNavbar } from '@/hooks/layout/use-navbar'
import { NavbarSearch } from './components/navbar-search'
import { NavbarNotifications } from './components/navbar-notification'
import { NavbarUserMenu } from './components/user-menu'
import { useAlerts } from '@/hooks/alerts/use-alerts'

export function Navbar({ onMenuClick }: NavbarProps) {
  const { session, profile, loading } = useNavbar()
  // Alerts fan out ~3N requests; keep them OFF the navbar's render gate so the
  // chrome paints immediately. The status pill carries its own loading state.
  const { alerts, loading: alertsLoading } = useAlerts()

  if (loading) return <NavbarSkeleton />

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden">
          <Search className="h-5 w-5" />
        </button>
      </div>

      <NavbarSearch />

      <div className="flex items-center gap-2 sm:gap-3">
        {alertsLoading ? (
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-[10px] font-semibold text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/50" />
            Checking…
          </div>
        ) : (
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-semibold',
              alerts.length === 0
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-red-500/30 bg-red-500/10 text-red-400',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                alerts.length === 0
                  ? 'bg-emerald-500'
                  : 'bg-red-500 animate-pulse',
              )}
            />
            {alerts.length === 0
              ? 'All Systems Healthy'
              : `${alerts.length} Active Alert${alerts.length > 1 ? 's' : ''}`}
          </div>
        )}

        {/* User Actions */}
        {session?.user ? (
          <>
            <NavbarNotifications />
            <NavbarUserMenu profile={profile} />
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Log in</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/register">Register</Link>
            </Button>
          </>
        )}
      </div>
    </header>
  )
}
