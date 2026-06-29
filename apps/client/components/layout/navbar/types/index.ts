export interface NavbarProps {
  onCreateWorkspace?: () => void
  onMenuClick?: () => void
}

export interface NotificationItem {
  id: string
  type: 'alert' | 'warning' | 'success' | 'info'
  title: string
  message: string
  workspace: string
  time: string
  read: boolean
}
