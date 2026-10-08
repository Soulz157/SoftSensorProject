'use client'

import { useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { datasetDraftService } from '@/services/dataset-draft'
import { dwDraftIdAtom } from '@/store/dataset-studio'

const HEARTBEAT_MS = 60_000

/**
 * DS-LAKE-014-T04: the wizard's own heartbeat, so the backend's ACTIVE-draft
 * idle sweep (CLEANUP_ACTIVE_EMPTY_MINUTES / CLEANUP_ACTIVE_IDLE_HOURS)
 * measures real absence — a tab closed or backgrounded — rather than
 * silence, e.g. a user reading Step 3.1's charts for twenty minutes without
 * issuing a single write.
 *
 * Beats only while `document.visibilityState === 'visible'`, and beats once
 * immediately on regaining visibility rather than waiting a full cadence —
 * a laptop woken from sleep with the wizard tab in front should not sit
 * "idle" for up to 60s before its clock catches up. A backgrounded or
 * closed tab stops beating entirely, which is the whole point: it is what
 * lets the short empty-draft tier be short without also being hostile to a
 * user who is genuinely still there.
 *
 * Mirrors `useModelDraftSync`'s timer-cleanup and silent-failure pattern —
 * a missed heartbeat is not user-visible; the draft simply idles one tick
 * closer to its window, exactly like a missed debounced PATCH there.
 */
export function useDatasetDraftHeartbeat(): void {
  const draftId = useAtomValue(dwDraftIdAtom)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!draftId) return

    const beat = () => {
      void datasetDraftService.touch(draftId).catch(() => {
        // Best-effort — a missed beat is not user-visible; the next one
        // 60s later (or the next visibility regain) catches up.
      })
    }

    const start = () => {
      if (intervalRef.current) return
      beat()
      intervalRef.current = setInterval(beat, HEARTBEAT_MS)
    }

    const stop = () => {
      if (!intervalRef.current) return
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stop()
    }
  }, [draftId])
}
