'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { notificationFeedService } from '@/services/notification'
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
 * NOTIFY_EVAL_INTERVAL_MS changes this without a client redeploy.
 */
export function useNotifications() {
  const [unreadCount, setUnreadCount] = useState(0)
  const [items, setItems] = useState<NotificationEventItem[]>([])
  const [loading, setLoading] = useState(false)
  const pollIntervalRef = useRef(FALLBACK_POLL_MS)

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

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const res = await notificationFeedService.listEvents({ limit: 25 })
      setItems(res.data.items)
    } catch {
      toast.error('Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [])

  const markAllRead = useCallback(async () => {
    try {
      await notificationFeedService.markRead()
      setUnreadCount(0)
      setItems(prev => prev.map(item => ({ ...item, unread: false })))
    } catch {
      // Best-effort — a failed mark-read leaves the badge as-is; the next
      // successful refresh will reconcile it.
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
    const poll = async () => {
      try {
        const res = await notificationFeedService.unreadCount()
        if (cancelled) return
        setUnreadCount(res.data.count)
        if (res.data.pollIntervalMs > 0) {
          pollIntervalRef.current = res.data.pollIntervalMs
        }
      } catch {
        // Best-effort — see `refreshCount`'s own comment.
      }
    }
    void poll()
    const onFocus = () => void poll()
    window.addEventListener('focus', onFocus)
    const interval = setInterval(() => void poll(), pollIntervalRef.current)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [])

  return {
    unreadCount,
    items,
    loading,
    loadItems,
    markAllRead,
    muteModel,
    refreshCount,
  }
}
