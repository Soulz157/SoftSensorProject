'use client'
import { Menu, Bell, Settings, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'

interface AdminNavbarProps {
  onMenuClick: () => void
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

export function AdminNavbar({ onMenuClick }: AdminNavbarProps) {
  const { data: session, status } = useSession()
  const isReady = status === 'authenticated'

  const userName = isReady
    ? `${session.user.firstName ?? ''} ${session.user.lastName ?? ''}`.trim() ||
      session.user.name ||
      'Admin'
    : 'Admin'
  const userEmail = isReady ? (session.user.email ?? '') : ''
  const userRole = isReady ? (session.user.role ?? '') : ''
  const roleLabel = userRole
    ? userRole.charAt(0) + userRole.slice(1).toLowerCase()
    : ''

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6">
      {/* Left */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold">Admin</h1>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Badge variant="secondary">{roleLabel}</Badge>

        <Button variant="ghost" size="icon">
          <Bell className="h-5 w-5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <UserInitials name={userName} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{userName}</p>
                <p className="text-xs text-muted-foreground">{userEmail}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Settings className="mr-2 h-4 w-4" />
                <Link href="/settings">Account Settings</Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
