import { ApiError } from '@/lib/fetcher'

/**
 * The line a notification settings table shows IN PLACE OF its empty state
 * when a load fails. A failed load used to leave the list empty, so the
 * table read "No notification channels yet." — a STAFF member hitting a
 * backend from before STAFF read access (2026-10-01) saw that, with only a
 * toast that disappears in seconds to say anything had gone wrong.
 *
 * Pure module — no React, no IO.
 */
export function describeNotificationLoadError(
  err: unknown,
  what: 'notification channels',
): string {
  if (err instanceof ApiError && err.status === 403) {
    return `You don't have access to this workspace's ${what}.`
  }
  const detail = err instanceof Error && err.message ? ` — ${err.message}` : ''
  return `Couldn't load ${what}${detail}`
}
