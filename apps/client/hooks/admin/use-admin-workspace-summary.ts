'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { workspaceService } from '@/services/workspace'
import type { AdminWorkspaceSummary } from '@/types'

/**
 * Whole-platform workspace summary for the admin dashboard header and
 * attention queue (one request — replaces the old per-workspace node
 * fan-out). A failure is returned as `error`, never as an empty "healthy"
 * summary. `revision`: bump to reload (e.g. after a workspace is created).
 */
export function useAdminWorkspaceSummary(revision = 0) {
  const { status } = useSession()
  const [data, setData] = useState<AdminWorkspaceSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (status !== 'authenticated') return
    let ignore = false
    // `queueMicrotask`: state is set after the effect body, not inside it.
    queueMicrotask(async () => {
      if (ignore) return
      setIsFetching(true)
      setError(null)
      try {
        const res = await workspaceService.getAdminWorkspaceSummary()
        if (!ignore) setData(res.data)
      } catch {
        if (!ignore) {
          // Drop the old numbers: stale counts beside an error would read as
          // current (and an empty queue as "all clear").
          setData(null)
          setError("Couldn't load the platform summary.")
        }
      } finally {
        if (!ignore) setIsFetching(false)
      }
    })
    return () => {
      ignore = true
    }
  }, [status, nonce, revision])

  const refetch = useCallback(() => setNonce(n => n + 1), [])

  return {
    data,
    loading: data === null && error === null,
    isFetching,
    error,
    refetch,
  }
}
