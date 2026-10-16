import type { WorkspaceLimitUsage } from '@/types'

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
): string | null {
  if (!limitUsage(limit, current).full) return null
  return `${NOUN[kind][0]!.toUpperCase()}${NOUN[kind].slice(1)} limit reached (${limit}). An admin can raise it.`
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
