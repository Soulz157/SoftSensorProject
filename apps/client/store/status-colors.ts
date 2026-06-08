export const STATUS_COLORS = {
  normal: '#22c55e',
  warning: '#f59e0b',
  alarm: '#ef4444',
  offline: '#71717a',
} as const

export type NodeStatus = 'normal' | 'warning' | 'alarm' | 'offline'

export interface MachineSvgProps {
  status: NodeStatus
  selected?: boolean
}
