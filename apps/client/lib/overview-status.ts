import type { CanvasNode } from '@/services/canvas'
import type { NodeStatus } from '@/store/status-colors'
export type { NodeStatus }

export const STATUS_META: Record<NodeStatus, { label: string; color: string }> =
  {
    alarm: { label: 'Alarm', color: '#ef4444' },
    warning: { label: 'Warning', color: '#f59e0b' },
    offline: { label: 'Offline', color: '#71717a' },
    normal: { label: 'Normal', color: '#22c55e' },
  }

export function deriveStatus(nodes: CanvasNode[]): NodeStatus {
  if (nodes.some(n => n.data.status === 'alarm')) return 'alarm'
  if (nodes.some(n => n.data.status === 'offline')) return 'offline'
  if (nodes.some(n => n.data.status === 'warning')) return 'warning'
  return 'normal'
}

export function countNodesByStatus(
  nodes: CanvasNode[],
): Record<NodeStatus, number> {
  const counts: Record<NodeStatus, number> = {
    alarm: 0,
    warning: 0,
    offline: 0,
    normal: 0,
  }
  for (const n of nodes) {
    const s = n.data.status as NodeStatus
    if (s in counts) counts[s]++
  }
  return counts
}

export interface SystemStatusSummary {
  totalAlarms: number
  totalWarnings: number
  hasOffline: boolean
  overallStatus: NodeStatus
  overallColor: string
}

export function deriveSystemStatus(
  nodesByWorkspace: Record<string, CanvasNode[]>,
): SystemStatusSummary {
  const allNodes = Object.values(nodesByWorkspace).flat()
  const totalAlarms = allNodes.filter(n => n.data.status === 'alarm').length
  const totalWarnings = allNodes.filter(n => n.data.status === 'warning').length
  const hasOffline = allNodes.some(n => n.data.status === 'offline')
  const overallStatus: NodeStatus =
    totalAlarms > 0
      ? 'alarm'
      : hasOffline
        ? 'offline'
        : totalWarnings > 0
          ? 'warning'
          : 'normal'
  return {
    totalAlarms,
    totalWarnings,
    hasOffline,
    overallStatus,
    overallColor: STATUS_META[overallStatus].color,
  }
}
