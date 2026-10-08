'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight } from 'lucide-react'
import { toast } from 'sonner'
import { notificationFeedService } from '@/services/notification'
import { notificationEventHref } from '@/lib/notification-event-link'
import {
  MAX_TOASTS,
  NOTIFICATION_TOASTER_ID,
  newToastEvents,
  notificationEventDetail,
  notificationToastTitle,
} from '@/lib/notification-toast'
import type { NotificationEventItem } from '@/types'

const FALLBACK_POLL_MS = 300_000 // matches NOTIFY_EVAL_INTERVAL_MS's own default.

/**
 * MODEL-SERVE-022-T08. Owns the fetch for the navbar bell; the component
 * (`navbar-notification.tsx`) stays a thin shell over this.
 *
 * Refresh triggers, per the ledger's own scope_note: window focus, opening
 * the bell, and an interval NEVER faster than the server's own
 * `pollIntervalMs` (the evaluator's sweep interval) — 001-T09's rule that
 * anything faster than the tick producing the data is load with no
 * information. The interval is read from the server on the FIRST
 * unread-count call, not hardcoded, so a deployment that retunes
 * NOTIFY_EVAL_INTERVAL_MS changes this without a client redeploy (each
 * poll schedules the next one with the CURRENT value).
 *
 * New WARNING / CRITICAL events also pop a toast with "Open" (see
 * lib/notification-toast.ts). Whatever already existed when the page loaded
 * is the baseline and never toasts — no backlog flood on sign-in.
 */
export function useNotifications() {
  const [unreadCount, setUnreadCount] = useState(0)
  const [items, setItems] = useState<NotificationEventItem[]>([])
  const [loading, setLoading] = useState(false)
  const pollIntervalRef = useRef(FALLBACK_POLL_MS)
  // Ids already accounted for; null until the mount-time baseline loads.
  const seenRef = useRef<Set<string> | null>(null)
  // The count the last poll saw — a rise means there is something new.
  const lastCountRef = useRef<number | null>(null)
  const router = useRouter()
  const routerRef = useRef(router)
  useEffect(() => {
    routerRef.current = router
  }, [router])

  const refreshCount = useCallback(async () => {
    try {
      const res = await notificationFeedService.unreadCount()
      setUnreadCount(res.data.count)
      if (res.data.pollIntervalMs > 0) {
        pollIntervalRef.current = res.data.pollIntervalMs
      }
    } catch {
      // Best-effort — a failed count refresh keeps the last known value
      // rather than flashing to 0 or surfacing a toast for a background poll.
    }
  }, [])

  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  /** Returns what was loaded (null on failure), so the caller can mark read
   *  only up to what the user was actually shown. */
  const loadItems = useCallback(async (): Promise<
    NotificationEventItem[] | null
  > => {
    setLoading(true)
    try {
      const res = await notificationFeedService.listEvents({ limit: 25 })
      setItems(res.data.items)
      return res.data.items
    } catch {
      toast.error('Failed to load notifications')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  /** `upTo` = the newest event shown. Without it the server marks up to
   *  "now", which would also mark read an event that arrived while the bell
   *  was opening — one the user never saw. */
  const markAllRead = useCallback(async (upTo?: string) => {
    try {
      await notificationFeedService.markRead(upTo)
      setUnreadCount(0)
      // Otherwise the next new event (count 1) would not look like a rise.
      lastCountRef.current = 0
      setItems(prev => prev.map(item => ({ ...item, unread: false })))
    } catch {
      // Best-effort — a failed mark-read leaves the badge as-is; the next
      // successful refresh will reconcile it.
    }
  }, [])

  /** The row's X — removes it from THIS user's bell. Silent on success (it
   *  is housekeeping, not news); on failure the row comes back. */
  const dismiss = useCallback(async (item: NotificationEventItem) => {
    setItems(prev => prev.filter(i => i.id !== item.id))
    if (item.unread) {
      setUnreadCount(c => Math.max(0, c - 1))
      // Keep the toast's "did the count rise?" check in step with the drop.
      if (lastCountRef.current) lastCountRef.current -= 1
    }
    try {
      await notificationFeedService.dismiss(item.id)
    } catch {
      setItems(prev =>
        [...prev, item].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      )
      if (item.unread) {
        setUnreadCount(c => c + 1)
        if (lastCountRef.current !== null) lastCountRef.current += 1
      }
      toast.error("Couldn't remove the notification")
    }
  }, [])

  /** "Clear all" — empties THIS user's bell up to the newest event shown.
   *  Silent on success; on failure the list comes back. */
  const clearAll = useCallback(async () => {
    const shown = itemsRef.current
    if (shown.length === 0) return
    setItems([])
    setUnreadCount(0)
    lastCountRef.current = 0
    try {
      await notificationFeedService.clear(shown[0]?.createdAt)
    } catch {
      setItems(shown)
      toast.error("Couldn't clear notifications")
    }
  }, [])

  const muteModel = useCallback(async (modelId: string) => {
    try {
      await notificationFeedService.muteModel(modelId)
      setItems(prev => prev.filter(item => item.modelId !== modelId))
      toast.success('Model muted for notifications')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to mute model')
    }
  }, [])

  useEffect(() => {
    // A LOCAL copy of `refreshCount`'s body, not a call to the outer
    // `useCallback` — same idiom `use-paginated-fetch.ts`'s own mount
    // effect already uses for the identical reason: a mount/interval
    // effect that calls a hook-level function is one more indirection than
    // it needs, and (react-hooks/set-state-in-effect) the effect owning
    // its own state updates directly is the pattern the rule expects.
    let cancelled = false
    let polling = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const show = (item: NotificationEventItem) => {
      const notify = item.severity === 'CRITICAL' ? toast.error : toast.warning
      notify(notificationToastTitle(item), {
        id: `notification-${item.id}`,
        toasterId: NOTIFICATION_TOASTER_ID,
        description: notificationEventDetail(item),
        action: {
          // Icon only, to keep the toast short; the name stays for screen
          // readers.
          label: (
            <>
              <ArrowUpRight className="size-3.5" aria-hidden />
              <span className="sr-only">Open {item.modelName}</span>
            </>
          ),
          onClick: () =>
            routerRef.current.push(
              notificationEventHref(item.modelId, item.kind),
            ),
        },
      })
    }

    /** Loads the latest events; toasts the new ones unless this is the
     *  baseline. Every fetched id is marked seen either way. */
    const announce = async (baseline: boolean) => {
      const res = await notificationFeedService.listEvents({ limit: 25 })
      if (cancelled) return
      const seen = seenRef.current ?? new Set<string>()
      const fresh = baseline ? [] : newToastEvents(res.data.items, seen)
      for (const item of res.data.items) seen.add(item.id)
      seenRef.current = seen
      fresh.slice(0, MAX_TOASTS).forEach(show)
      const more = fresh.length - MAX_TOASTS
      if (more > 0) {
        toast(`${more} more new notification${more === 1 ? '' : 's'}`, {
          toasterId: NOTIFICATION_TOASTER_ID,
          description: 'Open the bell to see them all.',
        })
      }
    }

    const poll = async () => {
      // A focus poll and a timer poll must not overlap: both would see the
      // same new event as unseen and toast it twice.
      if (polling) return
      polling = true
      try {
        const res = await notificationFeedService.unreadCount()
        if (cancelled) return
        const { count, pollIntervalMs } = res.data
        setUnreadCount(count)
        if (pollIntervalMs > 0) pollIntervalRef.current = pollIntervalMs
        const previous = lastCountRef.current
        lastCountRef.current = count
        if (seenRef.current === null) await announce(true)
        else if (previous !== null && count > previous) await announce(false)
      } catch {
        // Best-effort — see `refreshCount`'s own comment. A failed baseline
        // is retried on the next poll (and toasts nothing until it lands).
      } finally {
        polling = false
      }
    }

    // A timeout chain, not setInterval: each wait uses the interval the
    // server reported on the latest poll.
    const schedule = () => {
      timer = setTimeout(() => {
        void poll().finally(() => {
          if (!cancelled) schedule()
        })
      }, pollIntervalRef.current)
    }

    void poll().finally(() => {
      if (!cancelled) schedule()
    })
    const onFocus = () => void poll()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      clearTimeout(timer)
    }
  }, [])

  return {
    unreadCount,
    items,
    loading,
    loadItems,
    markAllRead,
    dismiss,
    clearAll,
    muteModel,
    refreshCount,
  }
}
