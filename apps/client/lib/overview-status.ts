import type { CanvasNode } from '@/services/canvas'
import type { NodeStatus } from '@/store/status-colors'
export type { NodeStatus }

export const STATUS_META: Record<NodeStatus, { label: string; color: string }> =
  {
    // MODEL-SERVE-024-D01: the stored value stays 'alarm'; it reads "Alert".
    alarm: { label: 'Alert', color: '#ef4444' },
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
 * Equipment/Node) — THE one Normal/Abnormal rule (MODEL-SERVE-024-D02).
 *
 * ABNORMAL only for `alarm` (read "Alert"). Warning and offline read Normal:
 * they still list on the Alerts page, but they do not turn a plant or
 * workspace red. A model's own fault folds in by mapping to `alarm` first
 * (`normalizeModelStatus` in lib/overview-tree.ts: a failed deploy or a
 * monitoring ALERT), so this one function decides for nodes and models alike.
 * Every caller asks this function rather than testing `!== 'normal'` itself.
 */
export type BinaryStatus = 'normal' | 'abnormal'

export function toBinaryStatus(
  status: NodeStatus | string | null | undefined,
): BinaryStatus {
  return status === 'alarm' ? 'abnormal' : 'normal'
}

/** `toBinaryStatus(status) === 'abnormal'`, for conditions. */
export function isAbnormal(
  status: NodeStatus | string | null | undefined,
): boolean {
  return toBinaryStatus(status) === 'abnormal'
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

/**
 * Whether one piece of equipment is Abnormal: its own status is an alert, OR a
 * model placed on it is abnormal (failed deploy / monitoring ALERT —
 * `abnormalModelCountByNodeId` in lib/model-status.ts builds that set).
 */
export function isNodeAbnormal(
  node: CanvasNode,
  abnormalModelNodeIds?: ReadonlySet<string>,
): boolean {
  return (
    isAbnormal(node.data.status) || Boolean(abnormalModelNodeIds?.has(node.id))
  )
}

export function deriveBinaryStatus(
  nodes: CanvasNode[],
  abnormalModelNodeIds?: ReadonlySet<string>,
): BinaryStatus {
  return nodes.some(n => isNodeAbnormal(n, abnormalModelNodeIds))
    ? 'abnormal'
    : 'normal'
}

export function countBinary(
  nodes: CanvasNode[],
  abnormalModelNodeIds?: ReadonlySet<string>,
): Record<BinaryStatus, number> {
  let abnormal = 0
  for (const n of nodes) {
    if (isNodeAbnormal(n, abnormalModelNodeIds)) abnormal++
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
