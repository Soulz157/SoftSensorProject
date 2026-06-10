import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useAlertCount } from '@/hooks/workspace/use-alert-count'
import type { NavItem } from '@/components/layout/sidebar/types'

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function workspaceStatusDot(status?: string): string {
  switch (status) {
    case 'alarm':
      return 'bg-red-500'
    case 'warning':
      return 'bg-amber-500'
    case 'offline':
      return 'bg-zinc-500'
    default:
      return 'bg-emerald-500'
  }
}

export function useSidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { workspaces } = useWorkspaces()
  const alertCount = useAlertCount()
  const isAdmin = session?.user?.role === 'ADMIN'

  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({
    models: pathname.startsWith('/models'),
    admin: pathname.startsWith('/admin'),
  })

  const [activeWorkspace, setActiveWorkspace] = useState('')
  const [workspaceOpen, setWorkspaceOpen] = useState(true)

  const currentWorkspace = workspaces.find(w => w.id === activeWorkspace)

  const rawFirstName =
    (session?.user as { firstName?: string } | undefined)?.firstName ?? ''
  const rawLastName =
    (session?.user as { lastName?: string } | undefined)?.lastName ?? ''
  const userName =
    (session?.user?.name ?? `${rawFirstName} ${rawLastName}`.trim()) || 'User'
  const userEmail = session?.user?.email ?? ''
  const initials = getInitials(userName)

  const toggleMenu = (id: string) => {
    setOpenMenus(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const isActiveNav = (href: string) => {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  const isAnyChildActive = (items: NavItem[]) =>
    items.some(c => c.href && isActiveNav(c.href))

  return {
    pathname,
    workspaces,
    alertCount,
    isAdmin,
    currentWorkspace,
    activeWorkspace,
    setActiveWorkspace,
    workspaceOpen,
    setWorkspaceOpen,
    openMenus,
    toggleMenu,
    isActiveNav,
    isAnyChildActive,
    user: {
      name: userName,
      email: userEmail,
      initials,
    },
  }
}

export type SidebarLogic = ReturnType<typeof useSidebar>
