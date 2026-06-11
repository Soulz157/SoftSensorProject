import {
  Activity,
  BarChart3,
  Box,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Cog,
  Eye,
  Factory,
  LayoutDashboard,
  Settings,
  TriangleAlert,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NavItem } from './types'

export const getUserNavItems = (alertCount: number): NavItem[] => [
  {
    id: 'overview',
    name: 'Overview',
    icon: <Factory className="h-4 w-4" />,
    href: '/overview',
  },
  {
    id: 'alerts',
    name: 'Alerts',
    icon: (
      <TriangleAlert
        className={cn('h-4 w-4', alertCount > 0 && 'animate-pulse')}
      />
    ),
    href: '/alerts',
    badge: alertCount > 0 ? alertCount : undefined,
  },
  {
    id: 'models',
    name: 'Models',
    icon: <Box className="h-4 w-4" />,
    children: [
      {
        id: 'models-view',
        name: 'View Model',
        icon: <Eye className="h-4 w-4" />,
        href: '/models/views',
      },
      {
        id: 'models-deployed',
        name: 'Check Deployed',
        icon: <CheckCircle2 className="h-4 w-4" />,
        href: '/models/deployed',
      },
      {
        id: 'models-quality',
        name: 'Data Quality Check',
        icon: <ClipboardCheck className="h-4 w-4" />,
        href: '/models/quality',
      },
    ],
  },
  {
    id: 'analytics',
    name: 'Analytics',
    icon: <BarChart3 className="h-4 w-4" />,
    href: '/analytics',
  },
  {
    id: 'settings',
    name: 'Settings',
    icon: <Settings className="h-4 w-4" />,
    href: '/settings',
  },
]

export const adminNavItems: NavItem[] = [
  {
    id: 'admin-dashboard',
    name: 'Admin Dashboard',
    icon: <LayoutDashboard className="h-4 w-4" />,
    href: '/admin/dashboard',
  },
  {
    id: 'admin-users',
    name: 'User Manage',
    icon: <Users className="h-4 w-4" />,
    href: '/admin/users',
  },
  {
    id: 'admin-activity',
    name: 'Activity Log',
    icon: <Activity className="h-4 w-4" />,
    href: '/admin/activity',
  },
  {
    id: 'admin-workspaces',
    name: 'Workspace Manage',
    icon: <Building2 className="h-4 w-4" />,
    href: '/admin/workspaces',
  },
  {
    id: 'admin-settings',
    name: 'System Setting',
    icon: <Cog className="h-4 w-4" />,
    href: '/admin/settings',
  },
]
