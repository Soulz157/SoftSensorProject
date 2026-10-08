import { toBinaryStatus, type BinaryStatus } from '@/lib/overview-status'
import type { NodeStatus } from '@/store/status-colors'

/**
 * Pure derivations for the All Workspaces page: the binary status rule,
 * search, the status filter, "needs attention first" ordering and the
 * summary line. Everything rides the list payload — no per-workspace fetch.
 */
export interface WorkspaceListItem {
  id: string
  name: string
  description?: string
  icon?: string
  color?: string
  status: NodeStatus
  /** Models that make the workspace Abnormal (failed deploy or monitoring
   *  ALERT) — MODEL-SERVE-024-D02. `null` while the model list is still
   *  loading: unknown, so no workspace may claim "0 need attention" yet. */
  abnormalModels: number | null
  /** `null`/`undefined` = the payload did not carry it: unknown, never 0. */
  modelsCount?: number | null
  plantsCount?: number | null
  datasetsCount?: number | null
  updatedAt: string
}

export type StatusFilter = 'all' | 'attention' | 'normal'

/** The binary status, plus `unknown` while it cannot be decided yet. */
export type ListStatus = BinaryStatus | 'unknown'

/**
 * Same rule as the sidebar and Overview: an alerting node OR an abnormal
 * model makes the workspace Abnormal. An alerting node is known from the
 * list payload, so that workspace is Abnormal at once. Otherwise, while the
 * model list has not loaded (`abnormalModels === null`), the workspace is
 * `unknown` — never a green "Normal" that may flip to red a moment later.
 */
export function workspaceStatus(ws: WorkspaceListItem): ListStatus {
  if (toBinaryStatus(ws.status) === 'abnormal') return 'abnormal'
  if (ws.abnormalModels === null) return 'unknown'
  return ws.abnormalModels > 0 ? 'abnormal' : 'normal'
}

/**
 * Map the workspace list payload to list items. `abnormalByWorkspace` is
 * `null` while the model list has not loaded, which makes every count
 * unknown rather than 0.
 */
export function toWorkspaceListItems(
  workspaces: readonly (Omit<WorkspaceListItem, 'abnormalModels'> & {
    status: NodeStatus
  })[],
  abnormalByWorkspace: Readonly<Record<string, number>> | null,
): WorkspaceListItem[] {
  return workspaces.map(w => ({
    id: w.id,
    name: w.name,
    description: w.description,
    icon: w.icon,
    color: w.color,
    status: w.status,
    abnormalModels: abnormalByWorkspace
      ? (abnormalByWorkspace[w.id] ?? 0)
      : null,
    modelsCount: w.modelsCount,
    plantsCount: w.plantsCount,
    datasetsCount: w.datasetsCount,
    updatedAt: w.updatedAt,
  }))
}

export function matchesQuery(ws: WorkspaceListItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    ws.name.toLowerCase().includes(q) ||
    (ws.description ?? '').toLowerCase().includes(q)
  )
}

export function filterWorkspaces(
  list: readonly WorkspaceListItem[],
  { query = '', status = 'all' }: { query?: string; status?: StatusFilter },
): WorkspaceListItem[] {
  return list.filter(ws => {
    if (!matchesQuery(ws, query)) return false
    if (status === 'all') return true
    // An `unknown` workspace belongs to neither filter until it is decided.
    const s = workspaceStatus(ws)
    return status === 'attention' ? s === 'abnormal' : s === 'normal'
  })
}

/**
 * Abnormal first (Serial Position — urgent items early), then by name.
 * Always sorted by name — the server sends no order — so the list is stable
 * from the first paint. Workspaces with an alerting node lead even while
 * model counts are unknown; once the models load, only the workspaces
 * Abnormal through a model move up.
 */
export function sortForAttention(
  list: readonly WorkspaceListItem[],
): WorkspaceListItem[] {
  return [...list].sort((a, b) => {
    const ra = workspaceStatus(a) === 'abnormal' ? 0 : 1
    const rb = workspaceStatus(b) === 'abnormal' ? 0 : 1
    return ra - rb || a.name.localeCompare(b.name)
  })
}

export interface WorkspaceSummary {
  total: number
  /** `null` while any workspace's abnormal count is unknown. */
  attention: number | null
  normal: number | null
  /** Sum of model counts, or `null` when any workspace's count is unknown —
   *  summing an unknown as zero would under-report. */
  models: number | null
}

export function summarizeWorkspaces(
  list: readonly WorkspaceListItem[],
): WorkspaceSummary {
  const attentionKnown = list.every(ws => ws.abnormalModels !== null)
  const attention = attentionKnown
    ? list.filter(ws => workspaceStatus(ws) === 'abnormal').length
    : null
  const models = list.some(ws => typeof ws.modelsCount !== 'number')
    ? null
    : list.reduce((sum, ws) => sum + (ws.modelsCount ?? 0), 0)
  return {
    total: list.length,
    attention,
    normal: attention === null ? null : list.length - attention,
    models,
  }
}

/** Workspaces per page on the All Workspaces list (user's call, 2026-10-07). */
export const WORKSPACES_PAGE_SIZE = 15

export interface WorkspacePage<T> {
  items: T[]
  /** 1-based, clamped into range. */
  page: number
  pageCount: number
  /** 1-based, inclusive range shown, e.g. "16–30 of 50". Zeros when empty. */
  from: number
  to: number
  total: number
}

/** Slice one page. An out-of-range `page` (e.g. after a filter shrinks the
 *  list) is clamped, never an empty page of a non-empty list. */
export function paginate<T>(
  list: readonly T[],
  page: number,
  size: number = WORKSPACES_PAGE_SIZE,
): WorkspacePage<T> {
  const total = list.length
  const pageCount = Math.max(1, Math.ceil(total / size))
  const safe = Math.min(Math.max(1, Math.floor(page) || 1), pageCount)
  const start = (safe - 1) * size
  const items = list.slice(start, start + size)
  return {
    items,
    page: safe,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: start + items.length,
    total,
  }
}

/**
 * The workspace filter to apply on /models/views, given the id asked for in
 * `?workspace=`. '' = All Workspaces. An id the user does not have falls back
 * to All (an empty table under a filter that matches nothing is worse); while
 * the workspace list is still empty it cannot be checked, so it is trusted.
 */
export function resolveWorkspaceFilter(
  requested: string,
  workspaces: readonly { id: string }[],
): string {
  if (!requested) return ''
  if (workspaces.length === 0) return requested
  return workspaces.some(w => w.id === requested) ? requested : ''
}

/**
 * Why the list is empty although workspaces exist, in the words of what the
 * user did — "nothing needs attention" is good news, not a failed search.
 */
export function noMatchMessage(query: string, status: StatusFilter): string {
  const searching = query.trim() !== ''
  if (searching) {
    return 'No workspace matches your search. Clear it or change the filter.'
  }
  if (status === 'attention') return 'No workspace needs attention.'
  if (status === 'normal') {
    return 'No workspace is reading Normal. Check the ones that need attention.'
  }
  return 'No workspaces to show.'
}
