'use client'

import Link from 'next/link'
import {
  Plus,
  Bell,
  Menu,
  Search,
  ExternalLink,
  LogOut,
  Settings,
  Clock,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSession, signOut } from 'next-auth/react'
import { useProfile } from '@/hooks/user/use-profile'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Input } from './ui/input'
import { cn } from '@/lib/utils'
import { TooltipContent, TooltipTrigger, Tooltip } from './ui/tooltip'
import { Badge } from './ui/badge'

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

const notifications = [
  {
    id: '1',
    type: 'alert',
    title: 'Model Alert',
    message: 'Vibration Anomaly Detector accuracy dropped below threshold',
    workspace: 'Acme Corporation',
    time: '2 min ago',
    read: false,
  },
  {
    id: '2',
    type: 'warning',
    title: 'High Memory Usage',
    message: 'Temperature Predictor using 89% memory',
    workspace: 'Smart Factory Alpha',
    time: '15 min ago',
    read: false,
  },
  {
    id: '3',
    type: 'success',
    title: 'Deployment Complete',
    message: 'Quality Inspector v2.1 deployed successfully',
    workspace: 'Energy Grid Monitor',
    time: '1 hour ago',
    read: true,
  },
  {
    id: '4',
    type: 'info',
    title: 'Scheduled Maintenance',
    message: 'System maintenance scheduled for tonight 2:00 AM',
    workspace: 'System',
    time: '3 hours ago',
    read: true,
  },
]

const searchSuggestions = {
  workspaces: [
    { id: '1', name: 'Acme Corporation', type: 'workspace' },
    { id: '2', name: 'Smart Factory Alpha', type: 'workspace' },
  ],
  models: [
    {
      id: '1',
      name: 'Vibration Anomaly Detector',
      workspace: 'Acme Corporation',
      type: 'model',
    },
    {
      id: '2',
      name: 'Temperature Predictor',
      workspace: 'Smart Factory Alpha',
      type: 'model',
    },
  ],
  nodes: [
    {
      id: '1',
      name: 'CNC Machine A1',
      workspace: 'Acme Corporation',
      type: 'node',
    },
    {
      id: '2',
      name: 'Assembly Robot B2',
      workspace: 'Smart Factory Alpha',
      type: 'node',
    },
  ],
}

const getNotificationIcon = (type: string) => {
  switch (type) {
    case 'alert':
      return <AlertCircle className="h-4 w-4 text-red-500" />
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-amber-500" />
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    default:
      return <Clock className="h-4 w-4 text-blue-500" />
  }
}

export function Navbar({ onCreateWorkspace, onMenuClick }: NavbarProps) {
  const { data: session } = useSession()
  const { profile, loading, refetch } = useProfile()
  const pathname = usePathname()

  const unreadCount = notifications.filter(n => !n.read).length

  const [searchQuery, setSearchQuery] = useState('')
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    refetch?.()
  }, [pathname, refetch])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refetch?.()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refetch])

  const filteredResults =
    searchQuery.length > 0
      ? {
          workspaces: searchSuggestions.workspaces.filter(w =>
            w.name.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
          models: searchSuggestions.models.filter(m =>
            m.name.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
          nodes: searchSuggestions.nodes.filter(n =>
            n.name.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
        }
      : searchSuggestions

  const hasResults =
    filteredResults.workspaces.length > 0 ||
    filteredResults.models.length > 0 ||
    filteredResults.nodes.length > 0

  if (loading) {
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
        <button className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors sm:hidden">
          <Search className="h-5 w-5" />
        </button>
      </div>

      {/* Desktop search */}
      <div className="flex flex-1 items-center justify-center px-4">
        <div ref={searchRef} className="relative w-full max-w-md">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="search"
              placeholder="Search workspaces, models, nodes..."
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value)
                setShowResults(true)
              }}
              onFocus={() => setShowResults(true)}
              className={cn(
                'h-9 w-full bg-secondary/50 pl-9 pr-20 text-sm',
                'placeholder:text-muted-foreground',
                'focus:bg-secondary focus:ring-1 focus:ring-primary/50',
                'transition-all duration-200',
              )}
            />
          </div>

          {/* Search Results Dropdown - Progressive Disclosure (Hick's Law) */}
          {showResults && (
            <div className="absolute top-full left-0 right-0 mt-2 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
              {!hasResults && searchQuery ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No results found for &quot;{searchQuery}&quot;
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {/* Workspaces Section - Miller's Law: Chunked information */}
                  {filteredResults.workspaces.length > 0 && (
                    <div className="border-b border-border p-2">
                      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                        Workspaces
                      </div>
                      {filteredResults.workspaces.map(item => (
                        <Link
                          key={item.id}
                          href={`/workspaces/${item.id}`}
                          className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
                          onClick={() => setShowResults(false)}
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <span className="text-xs font-semibold">
                              {item.name.substring(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <span className="text-sm">{item.name}</span>
                        </Link>
                      ))}
                    </div>
                  )}

                  {/* Models Section */}
                  {filteredResults.models.length > 0 && (
                    <div className="border-b border-border p-2">
                      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                        Models
                      </div>
                      {filteredResults.models.map(item => (
                        <Link
                          key={item.id}
                          href="/models"
                          className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-accent"
                          onClick={() => setShowResults(false)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
                              <span className="text-xs font-semibold">AI</span>
                            </div>
                            <div>
                              <div className="text-sm">{item.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {item.workspace}
                              </div>
                            </div>
                          </div>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </Link>
                      ))}
                    </div>
                  )}

                  {/* Nodes Section */}
                  {filteredResults.nodes.length > 0 && (
                    <div className="p-2">
                      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                        Nodes
                      </div>
                      {filteredResults.nodes.map(item => (
                        <Link
                          key={item.id}
                          href={`/workspaces/1`}
                          className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-accent"
                          onClick={() => setShowResults(false)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
                              <span className="text-xs font-semibold">N</span>
                            </div>
                            <div>
                              <div className="text-sm">{item.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {item.workspace}
                              </div>
                            </div>
                          </div>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-border bg-muted/50 px-3 py-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Type to search across all resources</span>
                  <span>ESC to close</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Button
          onClick={onCreateWorkspace}
          className="gap-2 cursor-pointer"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Create Workspace</span>
        </Button>

        {session?.user ? (
          <>
            <DropdownMenu>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'cursor-pointer',
                        'relative h-9 w-9',
                        'text-muted-foreground hover:text-foreground',
                        'transition-colors duration-150',
                      )}
                    >
                      <Bell className="h-5 w-5" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-medium text-white">
                          {unreadCount}
                        </span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {unreadCount > 0
                    ? `${unreadCount} unread notifications`
                    : 'Notifications'}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel className="flex items-center justify-between">
                  <span>Notifications</span>
                  {unreadCount > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {unreadCount} new
                    </Badge>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="max-h-80 overflow-y-auto">
                  {notifications.map(notification => (
                    <DropdownMenuItem
                      key={notification.id}
                      className={cn(
                        'flex flex-col items-start gap-1 p-3',
                        !notification.read && 'bg-primary/5',
                      )}
                    >
                      <div className="flex w-full items-start gap-3">
                        {getNotificationIcon(notification.type)}
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                              {notification.title}
                            </span>
                            {!notification.read && (
                              <span className="h-2 w-2 rounded-full bg-primary" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {notification.message}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{notification.workspace}</span>
                            <span>·</span>
                            <span>{notification.time}</span>
                          </div>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="justify-center text-primary">
                  View all notifications
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <UserInitials
                    name={
                      `${profile?.firstName?.[0] || ''} ${profile?.lastName?.[0] || ''}`.toUpperCase() ||
                      '?'
                    }
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-medium">
                      {`${profile?.firstName || ''} ${profile?.lastName || ''}`.toUpperCase() ??
                        profile?.email ??
                        'User'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {profile?.email}
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <Settings className="mr-2 h-4 w-4" />
                    <Link href="/settings">Account Settings</Link>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => signOut({ callbackUrl: '/auth/login' })}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
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
