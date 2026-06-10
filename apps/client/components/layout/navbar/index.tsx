// components/layout/navbar/index.tsx
'use client'

import Link from 'next/link'
import { Menu, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { NavbarProps } from './types'
import { NavbarSkeleton } from './components/skeleton'
import { useNavbar } from '@/hooks/layout/use-navbar'
import { NavbarSearch } from './components/navbar-search'
import { NavbarNotifications } from './components/navbar-notification'
import { NavbarUserMenu } from './components/user-menu'

export function Navbar({ onCreateWorkspace, onMenuClick }: NavbarProps) {
  const { session, profile, loading, alarmCount, isHealthy } = useNavbar()

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

      {/* 2. Center (Desktop Search) */}
      <NavbarSearch />

      {/* 3. Right side (Actions & Profile) */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Health Badge */}
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-semibold',
            isHealthy
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400',
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              isHealthy ? 'bg-emerald-500' : 'bg-red-500 animate-pulse',
            )}
          />
          {isHealthy
            ? 'All Systems Healthy'
            : `${alarmCount} Active Alarm${alarmCount > 1 ? 's' : ''}`}
        </div>

        {/* Create Workspace Button */}
        <Button
          onClick={onCreateWorkspace}
          className="gap-2 cursor-pointer"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Create Workspace</span>
        </Button>

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
