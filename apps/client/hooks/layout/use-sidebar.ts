import { useState } from 'react'
import { isAbnormal } from '@/lib/overview-status'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useAlertCount } from '@/hooks/workspace/use-alert-count'
import { useAllModels } from '@/hooks/use-all-models'
import { abnormalModelCountByWorkspace } from '@/lib/model-status'
import type { NavItem } from '@/components/layout/sidebar/types'

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

// Binary workspace indicator through THE one rule (MODEL-SERVE-024-D02):
// red only for an alerting workspace; warning/offline read green.
export function workspaceStatusDot(status?: string): string {
  return isAbnormal(status) ? 'bg-red-500' : 'bg-green-500'
}

export function useSidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { workspaces } = useWorkspaces()
  const alertCount = useAlertCount()
  const { models } = useAllModels()
  // MODEL-SERVE-024-D02. Models that make a workspace Abnormal: a failed
  // deploy or a monitoring ALERT. A monitoring WARN/FROZEN does not.
  const abnormalModelsByWorkspace = abnormalModelCountByWorkspace(models ?? [])
  const isAdmin = session?.user?.role === 'ADMIN'

  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({
    models: pathname.startsWith('/models'),
    'data-management': pathname.startsWith('/analytics'),
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
    abnormalModelsByWorkspace,
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
