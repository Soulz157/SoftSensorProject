'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Bell, Menu, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSession, signOut } from 'next-auth/react'

interface NavbarProps {
  onCreateWorkspace?: () => void
  onMenuClick?: () => void
}

function UserInitials({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
      {initials}
    </div>
  )
}

export function Navbar({ onCreateWorkspace, onMenuClick }: NavbarProps) {
  const { data: session, status } = useSession()
  const [searchOpen, setSearchOpen] = useState(false)

  console.log('Navbar session:', session?.user)

  if (status === 'loading') {
    return (
      <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6">
        {/* Left */}
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 animate-pulse rounded-md bg-muted lg:hidden" />
          <div className="h-9 w-9 animate-pulse rounded-md bg-muted sm:hidden" />
        </div>
        {/* Center — desktop search */}
        <div
          className="hidden flex-1 items-center gap-4 sm:flex"
          style={{ maxWidth: '28rem' }}
        >
          <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
        </div>
        {/* Right */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
          <div className="h-9 w-9 animate-pulse rounded-md bg-muted" />
          <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
        </div>
      </header>
    )
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6">
      {/* Left side */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          onClick={() => setSearchOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors sm:hidden"
        >
          <Search className="h-5 w-5" />
        </button>
      </div>

      {/* Desktop search */}
      <div className="hidden sm:flex items-center gap-4 flex-1 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search workspaces, models..."
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Button onClick={onCreateWorkspace} className="gap-2" size="sm">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Create Workspace</span>
        </Button>

        {session?.user ? (
          <>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <UserInitials
                    name={
                      `${session?.user?.firstName?.[0] || ''} ${session?.user?.lastName?.[0] || ''}`.toUpperCase() ||
                      '?'
                    }
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">
                    {`${session?.user?.firstName || ''} ${session?.user?.lastName || ''}`.toUpperCase() ??
                      session?.user.email ??
                      'User'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {session.user.email}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">Account Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => signOut({ callbackUrl: '/auth/login' })}
                  className="text-destructive focus:text-destructive"
                >
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
