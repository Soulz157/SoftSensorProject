import type { QuotaSource, WorkspaceLimitUsage } from '@/types'

/**
 * MODEL-SERVE-035. Per-workspace caps on models and members, client side.
 * Mirrors `apps/backend/src/lib/workspace-limits.ts` — the backend enforces
 * the cap; this only decides what the UI shows. null = no limit.
 *
 * Pure module — no React, no IO.
 */

export type LimitKind = 'models' | 'members'

export function limitUsage(
  limit: number | null | undefined,
  current: number,
): WorkspaceLimitUsage {
  if (limit == null) return { current, limit: null, full: false, over: false }
  return { current, limit, full: current >= limit, over: current > limit }
}

/** "4 / 5" with a cap, "4" without one. */
export function formatLimit(
  current: number,
  limit: number | null | undefined,
): string {
  return limit == null ? String(current) : `${current} / ${limit}`
}

const NOUN: Record<LimitKind, string> = { models: 'model', members: 'member' }

/** Why one more cannot be added, for a disabled control; null when it can. */
export function limitReachedNote(
  kind: LimitKind,
  limit: number | null | undefined,
  current: number,
  source: QuotaSource = 'admin',
): string | null {
  if (!limitUsage(limit, current).full) return null
  const head = `${NOUN[kind][0]!.toUpperCase()}${NOUN[kind].slice(1)} limit reached (${limit}).`
  return source === 'plan'
    ? `${head} The owner can upgrade, or an admin can raise it.`
    : `${head} An admin can raise it.`
}

/**
 * MODEL-SERVE-041. Why the caller cannot create another workspace, for a
 * disabled button; null when they can (or have no cap). Same words as the
 * backend's refusal.
 */
export function workspaceSlotNote(
  item: { current: number; limit: number | null } | null | undefined,
): string | null {
  if (!item || !limitUsage(item.limit, item.current).full) return null
  return `You have reached your workspace limit (${item.limit}) on your current plan. Upgrade your plan to create more.`
}

/**
 * MODEL-SERVE-040. The cap that applies: an admin override wins, else the
 * owner's plan quota, else none. Mirrors the backend's `pickLimit`.
 */
export function effectiveLimit(
  adminCap: number | null | undefined,
  planCap: number | null | undefined,
): { limit: number | null; source: QuotaSource } {
  if (adminCap != null) return { limit: adminCap, source: 'admin' }
  if (planCap != null) return { limit: planCap, source: 'plan' }
  return { limit: null, source: 'none' }
}

/** One line saying where a cap comes from. */
export function quotaSourceLabel(source: QuotaSource): string {
  if (source === 'admin') return 'Set by admin'
  if (source === 'plan') return "From owner's subscription"
  return 'No limit'
}

/** "Phoorich Maliwan"; one name alone; "Unknown" when the owner has none. */
export function ownerDisplayName(
  owner:
    | { firstName: string | null; lastName: string | null }
    | null
    | undefined,
): string {
  const name = [owner?.firstName, owner?.lastName]
    .map(part => part?.trim())
    .filter(Boolean)
    .join(' ')
  return name || 'Unknown'
}

/** Bar fill 0..100 for a capped quota; 0 with no limit. */
export function quotaPercent(item: {
  current: number
  limit: number | null
}): number {
  if (item.limit == null || item.limit <= 0) return 0
  return Math.min(100, Math.round((item.current / item.limit) * 100))
}

/**
 * The admin-side note when a cap is (or would be) below what the workspace
 * already has. Nothing is removed — new adds are refused until it is under.
 */
export function overLimitNote(
  kind: LimitKind,
  limit: number | null | undefined,
  current: number,
): string | null {
  if (!limitUsage(limit, current).over) return null
  return `${current} of ${limit}: over the limit. Nothing is removed; new ${kind} are blocked until there are fewer than ${limit}.`
}

/**
 * Parse the admin's input: blank = no limit (null); otherwise a whole number
 * 1..10000. `undefined` = not valid, so Save stays disabled.
 */
export function parseLimitInput(raw: string): number | null | undefined {
  const t = raw.trim()
  if (t === '') return null
  if (!/^\d+$/.test(t)) return undefined
  const n = Number(t)
  return n >= 1 && n <= 10000 ? n : undefined
}
