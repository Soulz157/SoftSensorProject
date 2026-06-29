export interface NavItem {
  id: string
  name: string
  icon: React.ReactNode
  href?: string
  children?: NavItem[]
  badge?: number
}

export interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}
