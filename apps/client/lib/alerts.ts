import type { CanvasNode } from '@/services/canvas'
import type { Workspace, WorkspacePlant } from '@/types'
import type { ModelWithWorkspace } from '@/hooks/use-all-models'
import { failedDeploys, monitoringAlerts } from '@/lib/model-status'
import { NODE_BADGE, NODE_DOT } from '@/constants/status'
import { formatHealthReason } from '@/lib/health-status-style'

/**
 * MODEL-SERVE-024-D01. FOUR statuses, one vocabulary for the badge, KPI cards
 * and filter:
 *   - `alert`   — equipment ALARM and model monitoring ALERT, merged: both
 *                 mean "this is wrong now and needs action".
 *   - `failed`  — Deploy Failed: the schedule is not dispatching. Kept apart
 *                 from `alert` because the fix is different (the deploy, not
 *                 the data); its vocabulary stays frozen per MODEL-SERVE-001-T22.
 *   - `warning` — equipment warning, and model monitoring WARN (input drift,
 *                 residual 1–2SD) or FROZEN (tag not moving).
 *   - `offline` — equipment offline.
 * The node wire value `'alarm'` is NOT renamed (it is stored canvas data);
 * `buildAlerts` maps it to `alert` at read time.
 */
export type AlertStatus = 'alert' | 'failed' | 'warning' | 'offline'
export type AlertNodeType =
  | 'sensor'
  | 'machine'
  | 'reactor'
  | 'model'
  | 'gateway'
  | 'unknown'

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
  /**
   * MODEL-SERVE-024-D04. The row's one-line detail in ONE format,
   * `Source: reason` — "Monitoring: No inference window", "Deploy: <error>",
   * "Sensor: Alert". Built by `buildAlerts`, rendered as-is.
   */
  detail: string
  /** The operator's own free-text note on the model (`statusDetail`), shown
   * under `detail` when present. Null on node rows. */
  detailError: string | null
  /**
   * MODEL-SERVE-001-T23. The REAL failure cause — the most recent FAILED
   * InferenceWindow's own redacted `failureReason`, carried on the models
   * list payload by `deriveDeployStatuses` so this stays a pure function
   * over that list rather than N per-model status requests.
   *
   * REPLACES an `errorLogs: ModelLog[]` field filtered out of
   * `model.data.logs` on `level === 'error'`. That filter was empty BY
   * CONSTRUCTION, not by bug: every `appendModelLog` call site in the
   * client hardcodes `level: 'info'` (and they live in a mock retrain
   * simulation), so no code path has ever produced the level it looked
   * for. `model.data.logs` was never the deploy-failure source of truth
   * either — `classifyDeployStatus` reads InferenceWindow directly.
   */
  failureReason: string | null
  /**
   * MODEL-SERVE-001-T30. The MONITORING axis's reason code, raw off the wire
   * and rendered through `HEALTH_REASON_LABEL` — never inferred from
   * `status`, because the codes collapse faults with opposite actions
   * (SOURCE_UNREACHABLE means go to the connector, STALE means go to the
   * scheduler). Null on every node row and every deploy-failed row: those
   * carry `failureReason` instead, which is a different axis and a free-text
   * value rather than an enum.
   */
  monitoringReason: string | null
  affectedNode?: { name: string; planName: string | null }
  href: string
  timestamp: string
}

/**
 * MODEL-SERVE-024-D01. THE one table: label, badge text, dot, pulse and sort
 * order per status. The badge, KPI cards and filter all read from here (via
 * the maps below), so a status can no longer be worded or coloured two ways.
 * Red is reserved for the two Abnormal statuses, amber for Warning, grey for
 * Offline — workspace/plant status colours (DESIGN_SYSTEM.md §5).
 */
export const ALERT_STATUS_META: Record<
  AlertStatus,
  {
    label: string
    /** Plural for count cards ("Alerts"). */
    plural: string
    badge: string
    dot: string
    pulse: boolean
    /** Lower = more severe — drives the default sort. */
    priority: number
    /** MODEL-SERVE-024-D02: counts toward Abnormal on plant/workspace. */
    abnormal: boolean
  }
> = {
  failed: {
    label: 'Deploy Failed',
    plural: 'Deploy Failed',
    badge: 'text-destructive',
    dot: 'bg-destructive',
    pulse: true,
    priority: 0,
    abnormal: true,
  },
  alert: {
    label: 'Alert',
    plural: 'Alerts',
    badge: NODE_BADGE.alarm ?? 'text-destructive',
    dot: NODE_DOT.alarm ?? 'bg-destructive',
    pulse: true,
    priority: 1,
    abnormal: true,
  },
  offline: {
    label: 'Offline',
    plural: 'Offline',
    badge: NODE_BADGE.offline ?? '',
    dot: NODE_DOT.offline ?? '',
    pulse: false,
    priority: 2,
    abnormal: false,
  },
  warning: {
    label: 'Warning',
    plural: 'Warnings',
    badge: NODE_BADGE.warning ?? '',
    dot: NODE_DOT.warning ?? '',
    pulse: false,
    priority: 3,
    abnormal: false,
  },
}

function metaMap<T>(pick: (m: (typeof ALERT_STATUS_META)[AlertStatus]) => T) {
  return Object.fromEntries(
    (Object.keys(ALERT_STATUS_META) as AlertStatus[]).map(k => [
      k,
      pick(ALERT_STATUS_META[k]),
    ]),
  ) as Record<AlertStatus, T>
}

export const ALERT_STATUS_PRIORITY = metaMap(m => m.priority)
export const ALERT_STATUS_LABEL = metaMap(m => m.label)
export const ALERT_STATUS_BADGE = metaMap(m => m.badge)
export const ALERT_STATUS_DOT = metaMap(m => m.dot)
/** Statuses that get a pulsing dot — the two Abnormal ones (Von Restorff). */
export const ALERT_STATUS_PULSE = metaMap(m => m.pulse)

/** Display order for filters and count cards: most severe first. */
export const ALERT_STATUS_ORDER: AlertStatus[] = (
  Object.keys(ALERT_STATUS_META) as AlertStatus[]
).sort((a, b) => ALERT_STATUS_PRIORITY[a] - ALERT_STATUS_PRIORITY[b])

/** Node wire status → alert status. Only the three non-normal node states
 * become rows; `'alarm'` (stored canvas value) reads as `alert`. */
const NODE_TO_ALERT: Record<string, AlertStatus> = {
  alarm: 'alert',
  warning: 'warning',
  offline: 'offline',
}

/** Model monitoring status (off the list payload) → alert status, or null
 * when it raises nothing. FROZEN reads Warning (MODEL-SERVE-024, user's call). */
export function monitoringToAlertStatus(
  status: string | null | undefined,
): AlertStatus | null {
  if (status === 'ALERT' || status === 'CRITICAL') return 'alert'
  if (status === 'WARN' || status === 'FROZEN') return 'warning'
  return null
}

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
 * (failed → alert → offline → warning).
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
      const status = NODE_TO_ALERT[node.data.status]
      if (!status) continue
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
        detail: `${capitalize(node.data.type)}: ${ALERT_STATUS_LABEL[status]}`,
        detailError: null,
        // Equipment rows have no deploy to fail — this field is the model
        // plane's, and a node alert is a different kind of event entirely.
        failureReason: null,
        monitoringReason: null,
        href: `/plants/${workspace.id}?nodeId=${node.id}`,
        timestamp: node.updatedAt,
      })
    }
  }

  // 2) Failed model deploys.
  for (const model of failedDeploys(models)) {
    // MODEL-SERVE-001-T23. The real source, off the list payload — see
    // AlertRow.failureReason for why `model.data.logs` was never it.
    const lastFailure = model.data?.lastFailure ?? null
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
      // A deploy fails only when the source check at Start is refused
      // (MODEL-SERVE-001-T26). `lastFailure` is the newest FAILED inference
      // WINDOW — a different event — so it is NOT put behind "Deploy:"; it
      // stays in the expanded Failure Reason section, as before.
      detail: 'Deploy: Source check refused at start',
      detailError: model.data?.statusDetail ?? null,
      failureReason: lastFailure?.reason ?? null,
      monitoringReason: null,
      affectedNode: model.nodes
        ? { name: equipmentName ?? 'Unknown Node', planName: plantName }
        : undefined,
      href: `/models/${model.id}`,
      // The failing window's own start, not the row's last edit — a model
      // untouched for a week whose deploy broke an hour ago should sort and
      // filter by the failure, which is what this column means everywhere
      // else in this list.
      timestamp: lastFailure?.at ?? model.updatedAt,
    })
  }

  // 3) MODEL-SERVE-001-T30. Monitoring alerts — the axis T26 split off.
  //
  // WHY THIS LOOP EXISTS: since T26, three consecutive FAILED windows no
  // longer set `deployStatus === 'error'`, so `failedDeploys` above stopped
  // seeing them and this page went silent for that entire failure class. A
  // dead source was visible on the model detail page and nowhere else.
  //
  // Deliberately a SECOND pass rather than a branch inside loop 2: a model
  // can be BOTH deploy-failed (a refused preflight) and monitoring-alerting
  // at once, and those are two findings with two different fixes, so they get
  // two rows.
  for (const model of monitoringAlerts(models)) {
    const monitoring = model.data?.monitoring ?? null
    // MODEL-SERVE-024-D01: ALERT reads Alert; WARN and FROZEN read Warning.
    const status = monitoringToAlertStatus(monitoring?.status)
    if (!status) continue
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
      // SUFFIXED, and it must stay that way: `alerts-group-list.tsx` keys its
      // React children on `${row.kind}-${row.id}`, so a model carrying both a
      // deploy failure and a monitoring alert would render two children with
      // one key — React drops one, silently, and the page shows a single row
      // for two separate problems.
      id: `${model.id}:monitoring`,
      kind: 'model',
      equipmentName,
      modelName: model.name,
      workspaceId: model.workspaceId,
      workspaceName:
        model.workspaceName ?? workspaceNameById.get(model.workspaceId) ?? '—',
      plantName,
      typeLabel: ALERT_STATUS_LABEL[status],
      typeName: 'Model',
      status,
      detail: `Monitoring: ${
        formatHealthReason(monitoring?.reason ?? null) ??
        ALERT_STATUS_LABEL[status]
      }`,
      detailError: model.data?.statusDetail ?? null,
      // The OTHER axis's value stays null here — a monitoring alert has no
      // FAILED window reason, and borrowing one would name the wrong cause.
      failureReason: null,
      monitoringReason: monitoring?.reason ?? null,
      affectedNode: model.nodes
        ? { name: equipmentName ?? 'Unknown Node', planName: plantName }
        : undefined,
      href: `/models/${model.id}`,
      // `model.updatedAt`, NOT `lastFailure.at`: the list payload carries no
      // monitoring-event timestamp (it would need the per-window read the
      // batched derivation exists to avoid), and borrowing the deploy axis's
      // time would date this row by an unrelated event.
      timestamp: model.updatedAt,
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

export type AlertCounts = Record<AlertStatus, number>

export function countByStatus(rows: AlertRow[]): AlertCounts {
  const counts: AlertCounts = { alert: 0, failed: 0, warning: 0, offline: 0 }
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
