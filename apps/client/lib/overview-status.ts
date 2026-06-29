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

/**
 * Binary status layer for physical/organizational entities (Workspace, Plant,
 * Equipment/Node). Display-only collapse of the 4-state `NodeStatus`: anything
 * that is not `normal` (warning/alarm/offline) reads as a single `abnormal`
 * (red) state. Models are NOT covered by this — they keep their own status
 * system (`lib/model-status.ts`).
 */
export type BinaryStatus = 'normal' | 'abnormal'

export function toBinaryStatus(status: NodeStatus): BinaryStatus {
  return status === 'normal' ? 'normal' : 'abnormal'
}

/**
 * Visual tokens for the binary indicator. green-500 / red-500 keep adequate
 * contrast on the deep-navy dark shell; `dot`/`text` are Tailwind classes and
 * `color` is the raw hex for SVG fills/strokes (matches STATUS_COLORS).
 */
export const BINARY_STATUS_META: Record<
  BinaryStatus,
  { label: string; color: string; dot: string; text: string }
> = {
  normal: {
    label: 'Normal',
    color: '#22c55e',
    dot: 'bg-green-500',
    text: 'text-green-700 dark:text-green-400',
  },
  abnormal: {
    label: 'Abnormal',
    color: '#ef4444',
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-400',
  },
}

export function deriveBinaryStatus(nodes: CanvasNode[]): BinaryStatus {
  return toBinaryStatus(deriveStatus(nodes))
}

export function countBinary(nodes: CanvasNode[]): Record<BinaryStatus, number> {
  let abnormal = 0
  for (const n of nodes) {
    if ((n.data.status as NodeStatus) !== 'normal') abnormal++
  }
  return { normal: nodes.length - abnormal, abnormal }
}

const SEVERITY_ORDER: Record<NodeStatus, number> = {
  alarm: 3,
  offline: 2,
  warning: 1,
  normal: 0,
}

export function equipmentAlerts(nodes: CanvasNode[]): CanvasNode[] {
  return nodes
    .filter(n => n.data.status !== 'normal')
    .sort(
      (a, b) =>
        SEVERITY_ORDER[b.data.status as NodeStatus] -
        SEVERITY_ORDER[a.data.status as NodeStatus],
    )
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
