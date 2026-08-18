import type { CanvasNode } from '@/services/canvas'
import type { ModelLog, Workspace, WorkspacePlant } from '@/types'
import type { ModelWithWorkspace } from '@/hooks/use-all-models'
import { failedDeploys } from '@/lib/model-status'
import { NODE_BADGE, NODE_DOT } from '@/constants/status'

export type AlertStatus = 'failed' | 'alarm' | 'offline' | 'warning'
export type AlertNodeType =
  | 'sensor'
  | 'machine'
  | 'controller'
  | 'model'
  | 'gateway'
  | 'unknown'

export const AlertClass: Record<AlertStatus, string> = {
  alarm: 'bg-red-500/10 text-red-500',
  offline: 'bg-zinc-500/10 text-zinc-500',
  warning: 'bg-amber-500/10 text-amber-500',
  failed: 'bg-red-500/10 text-red-600',
}

export interface AlertRow {
  id: string
  kind: 'node' | 'model'
  equipmentName: string | null
  modelName: string | null
  workspaceId: string
  workspaceName: string
  plantName: string | null
  typeLabel: string
  typeName: string
  status: AlertStatus
  detailError: string | null
  errorLogs?: ModelLog[]
  affectedNode?: { name: string; planName: string | null }
  href: string
  timestamp: string
}

/** Severity order (lower = more severe) — drives the default sort. */
export const ALERT_STATUS_PRIORITY: Record<AlertStatus, number> = {
  failed: 0,
  alarm: 1,
  offline: 2,
  warning: 3,
}

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  failed: 'Deploy Failed',
  alarm: 'Alarm',
  offline: 'Offline',
  warning: 'Warning',
}

/**
 * Status visual tokens. Reuses the shared node maps (`constants/status.ts`),
 * extended only for the model-only `failed` value (red, like an alarm).
 */
export const ALERT_STATUS_BADGE: Record<AlertStatus, string> = {
  failed: 'text-destructive',
  alarm: NODE_BADGE.alarm ?? '',
  offline: NODE_BADGE.offline ?? '',
  warning: NODE_BADGE.warning ?? '',
}

export const ALERT_STATUS_DOT: Record<AlertStatus, string> = {
  failed: 'bg-destructive',
  alarm: NODE_DOT.alarm ?? '',
  offline: NODE_DOT.offline ?? '',
  warning: NODE_DOT.warning ?? '',
}

/** Statuses that get a pulsing dot — the most urgent (Von Restorff). */
export const ALERT_STATUS_PULSE: Record<AlertStatus, boolean> = {
  failed: true,
  alarm: true,
  offline: false,
  warning: false,
}

const NODE_ALERT_STATUSES: ReadonlySet<string> = new Set([
  'alarm',
  'offline',
  'warning',
])

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function deriveNodeTypeLabel(
  nodeType: CanvasNode['data']['type'],
  status: AlertStatus,
): string {
  return `${capitalize(nodeType)} ${ALERT_STATUS_LABEL[status]}`
}

/** "Workspace > Plant" (or just workspace when the plant is unknown). */
export function formatLocation(row: AlertRow): string {
  return row.plantName
    ? `${row.workspaceName} > ${row.plantName}`
    : row.workspaceName
}

/**
 * Ordered, non-null location segments for breadcrumb display (row UI only —
 * `formatLocation` above stays unchanged since sort/filter/location-options
 * and existing tests depend on its exact "Workspace > Plant" contract).
 * Node rows already show the equipment name as the row title, so the
 * breadcrumb stops at the plant to avoid repeating it. Model rows show the
 * model name as the title, so the affected equipment name (if any) is a
 * genuinely new segment and is appended.
 */
export function locationBreadcrumb(row: AlertRow): string[] {
  const segments = [row.workspaceName]
  if (row.plantName) segments.push(row.plantName)
  if (row.kind === 'model' && row.equipmentName) {
    segments.push(row.equipmentName)
  }
  return segments
}

interface BuildAlertsArgs {
  workspaces: Workspace[]
  nodesByWorkspaceId: Record<string, CanvasNode[]>
  plantsByWorkspaceId: Record<string, WorkspacePlant[]>
  models: ModelWithWorkspace[]
}

/**
 * Pure assembly of the unified alert list. Default-sorted by severity
 * (failed → alarm → offline → warning).
 */
export function buildAlerts({
  workspaces,
  nodesByWorkspaceId,
  plantsByWorkspaceId,
  models,
}: BuildAlertsArgs): AlertRow[] {
  const workspaceNameById = new Map(workspaces.map(w => [w.id, w.name]))

  // workspaceId -> (planId -> plant name) for resolving node Location.
  const plantNameByWorkspacePlan = new Map<string, Map<string, string>>()
  for (const [wsId, plants] of Object.entries(plantsByWorkspaceId)) {
    plantNameByWorkspacePlan.set(wsId, new Map(plants.map(p => [p.id, p.name])))
  }

  const rows: AlertRow[] = []

  // 1) Equipment node alerts.
  for (const workspace of workspaces) {
    const nodes = nodesByWorkspaceId[workspace.id] ?? []
    for (const node of nodes) {
      if (!NODE_ALERT_STATUSES.has(node.data.status)) continue
      const status = node.data.status as AlertStatus
      rows.push({
        id: node.id,
        kind: 'node',
        equipmentName: node.data.name,
        modelName: null,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        plantName:
          plantNameByWorkspacePlan.get(workspace.id)?.get(node.planId) ?? null,
        typeLabel: deriveNodeTypeLabel(node.data.type, status),
        typeName: capitalize(node.data.type),
        status,
        detailError: null,
        href: `/plants/${workspace.id}?nodeId=${node.id}`,
        timestamp: node.updatedAt,
      })
    }
  }

  // 2) Failed model deploys.
  for (const model of failedDeploys(models)) {
    const errorLogs = (model.data?.logs ?? [])
      .filter(l => l.level === 'error')
      .slice(-3)
    const nodeData = model.nodes?.data as { name?: string } | undefined
    const equipmentName = model.nodes
      ? (nodeData?.name ?? 'Unknown Node')
      : null
    const plantName =
      model.nodes?.plan?.name ??
      (model.nodes
        ? (plantNameByWorkspacePlan
            .get(model.workspaceId)
            ?.get(model.nodes.planId) ?? null)
        : null)

    rows.push({
      id: model.id,
      kind: 'model',
      equipmentName,
      modelName: model.name,
      workspaceId: model.workspaceId,
      workspaceName:
        model.workspaceName ?? workspaceNameById.get(model.workspaceId) ?? '—',
      plantName,
      typeLabel: ALERT_STATUS_LABEL.failed,
      typeName: 'Model',
      status: 'failed',
      detailError: model.data?.statusDetail ?? null,
      errorLogs: errorLogs.length > 0 ? errorLogs : undefined,
      affectedNode: model.nodes
        ? { name: equipmentName ?? 'Unknown Node', planName: plantName }
        : undefined,
      href: `/models/${model.id}`,
      timestamp: errorLogs.at(-1)?.timestamp ?? model.updatedAt,
    })
  }

  return rows.sort(compareBySeverity)
}

export type SortKey = 'status' | 'location'
export type SortDir = 'asc' | 'desc'

export function compareBySeverity(a: AlertRow, b: AlertRow): number {
  return (
    (ALERT_STATUS_PRIORITY[a.status] ?? 99) -
    (ALERT_STATUS_PRIORITY[b.status] ?? 99)
  )
}

function compareByLocation(a: AlertRow, b: AlertRow): number {
  return formatLocation(a).localeCompare(formatLocation(b))
}

/** Returns a new sorted array — does not mutate the input. */
export function sortAlerts(
  rows: AlertRow[],
  key: SortKey,
  dir: SortDir,
): AlertRow[] {
  const base = key === 'location' ? compareByLocation : compareBySeverity
  const sorted = [...rows].sort(base)
  return dir === 'desc' ? sorted.reverse() : sorted
}

export interface AlertFilters {
  status: AlertStatus | 'all'
  location: string | 'all'
  type: string | 'all'
  search: string
  dateFrom: string | null
  dateTo: string | null
}

export const EMPTY_FILTERS: AlertFilters = {
  status: 'all',
  location: 'all',
  type: 'all',
  search: '',
  dateFrom: null,
  dateTo: null,
}

export function filterAlerts(rows: AlertRow[], f: AlertFilters): AlertRow[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter(row => {
    if (f.status !== 'all' && row.status !== f.status) return false
    if (f.location !== 'all' && formatLocation(row) !== f.location) return false
    if (f.type !== 'all' && row.typeLabel !== f.type) return false
    if (f.dateFrom && row.timestamp < f.dateFrom) return false
    if (f.dateTo && row.timestamp > f.dateTo) return false
    if (q) {
      const haystack =
        `${row.equipmentName ?? ''} ${row.modelName ?? ''}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
}

export function locationOptions(rows: AlertRow[]): string[] {
  return Array.from(new Set(rows.map(formatLocation))).sort((a, b) =>
    a.localeCompare(b),
  )
}

export function typeOptions(rows: AlertRow[]): string[] {
  return Array.from(new Set(rows.map(r => r.typeLabel))).sort((a, b) =>
    a.localeCompare(b),
  )
}

export interface AlertCounts {
  failed: number
  alarm: number
  offline: number
  warning: number
}

export function countByStatus(rows: AlertRow[]): AlertCounts {
  const counts: AlertCounts = { failed: 0, alarm: 0, offline: 0, warning: 0 }
  for (const r of rows) counts[r.status]++
  return counts
}

export interface AlertGroup {
  workspaceId: string
  workspaceName: string
  rows: AlertRow[]
}

/**
 * Groups rows by workspace, severity-sorting within each group. Groups are
 * ordered worst-severity-first (the most severe row in the group), with an
 * alphabetical tiebreak — so the workspace that needs attention most surfaces
 * at the top of the list.
 */
export function groupByWorkspace(rows: AlertRow[]): AlertGroup[] {
  const byId = new Map<string, AlertGroup>()
  for (const row of rows) {
    let group = byId.get(row.workspaceId)
    if (!group) {
      group = {
        workspaceId: row.workspaceId,
        workspaceName: row.workspaceName,
        rows: [],
      }
      byId.set(row.workspaceId, group)
    }
    group.rows.push(row)
  }

  const groups = Array.from(byId.values())
  for (const group of groups) group.rows.sort(compareBySeverity)

  groups.sort((a, b) => {
    const aBest = Math.min(...a.rows.map(r => ALERT_STATUS_PRIORITY[r.status]))
    const bBest = Math.min(...b.rows.map(r => ALERT_STATUS_PRIORITY[r.status]))
    return aBest - bBest || a.workspaceName.localeCompare(b.workspaceName)
  })

  return groups
}
