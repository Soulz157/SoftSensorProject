import { isAbnormal } from '@/lib/overview-status'
import type { AdminWorkspace, AdminWorkspaceOwner } from '@/types'

/**
 * Pure derivations for the admin dashboard: owner names, the equipment
 * wording on the attention queue and table, and the one-line summary. Admin
 * status is EQUIPMENT (node) status only — the admin API does not know
 * model-level status, so nothing here claims it.
 */

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** "First Last", falling back to the e-mail when no name is set. */
export function ownerName(owner: AdminWorkspaceOwner): string {
  const name = [owner.firstName, owner.lastName]
    .map(p => p?.trim())
    .filter(Boolean)
    .join(' ')
  return name || owner.email
}

export interface EquipmentCounts {
  alarmCount?: number
  warningCount?: number
  offlineCount?: number
}

/**
 * What is wrong with the equipment, split so only the ALARM part can carry
 * the attention colour: warnings and offline equipment are listed, never
 * coloured (or counted) as alarms.
 */
export function equipmentParts(c: EquipmentCounts): {
  alarm: string | null
  other: string | null
} {
  const other: string[] = []
  if (c.warningCount) {
    other.push(
      `${c.warningCount} ${plural(c.warningCount, 'warning', 'warnings')}`,
    )
  }
  if (c.offlineCount) other.push(`${c.offlineCount} offline`)
  return {
    alarm: c.alarmCount ? `${c.alarmCount} in alarm` : null,
    other: other.length > 0 ? other.join(' · ') : null,
  }
}

/** "2 in alarm · 1 offline", or `null` when nothing is wrong. */
export function equipmentDetail(c: EquipmentCounts): string | null {
  const { alarm, other } = equipmentParts(c)
  const parts = [alarm, other].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** A workspace needs attention when its equipment is in ALARM — the same
 *  binary rule as `toBinaryStatus` everywhere else. */
export function needsAttention(ws: Pick<AdminWorkspace, 'status'>): boolean {
  return isAbnormal(ws.status)
}

export interface SummarySegment {
  key: 'workspaces' | 'attention' | 'models' | 'users'
  /** The figure as shown ("12"), or `null` while unknown. */
  value: string | null
  /** What it counts ("workspaces", "need attention"). */
  label: string
  /** `${value ?? '—'} ${label}` — what a plain-text reader sees. */
  text: string
  /** `attention` > 0 is the one segment that carries the attention colour. */
  attention?: boolean
}

/** `null` = not loaded (or failed): shown as "—", never a guessed 0. */
export function adminSummarySegments(input: {
  total: number | null
  attention: number | null
  models: number | null
  users: number | null
}): SummarySegment[] {
  const seg = (
    key: SummarySegment['key'],
    n: number | null,
    one: string,
    many: string,
    attention?: boolean,
  ): SummarySegment => {
    const label = n === 1 ? one : many
    return {
      key,
      value: n === null ? null : String(n),
      label,
      text: `${n === null ? '—' : n} ${label}`,
      attention,
    }
  }
  const { total, attention, models, users } = input
  return [
    seg('workspaces', total, 'workspace', 'workspaces'),
    seg(
      'attention',
      attention,
      'needs attention',
      'need attention',
      attention !== null && attention > 0,
    ),
    seg('models', models, 'model', 'models'),
    seg('users', users, 'user', 'users'),
  ]
}

/** What an activity row says. Admin activity is authentication only. */
export function activityVerb(action: 'LOGIN' | 'LOGOUT'): string {
  return action === 'LOGIN' ? 'signed in' : 'signed out'
}

/** Workspaces per page on the admin dashboard table. */
export const ADMIN_PAGE_SIZE = 15

/**
 * The pager's view of a SERVER page, labelled from the page the server
 * ANSWERED with (`data.page`), never the page the user just asked for: while
 * the next page loads the old rows stay on screen, and a label built from the
 * requested page would put page-1 rows under "16–30". An out-of-range page
 * comes back as an empty list (the server does not pull it back), so the
 * table can say "this page is empty" instead of "no workspaces". `null` (not
 * loaded) reads as an empty first page.
 */
export function pageFromServer<T>(
  data: { items: T[]; total: number; page: number; limit: number } | null,
): {
  items: T[]
  page: number
  pageCount: number
  from: number
  to: number
  total: number
} {
  if (!data) {
    return { items: [], page: 1, pageCount: 1, from: 0, to: 0, total: 0 }
  }
  const pageCount = Math.max(1, Math.ceil(data.total / data.limit))
  const start = (data.page - 1) * data.limit
  return {
    items: data.items,
    page: data.page,
    pageCount,
    from: data.items.length === 0 ? 0 : start + 1,
    to: data.items.length === 0 ? 0 : start + data.items.length,
    total: data.total,
  }
}
