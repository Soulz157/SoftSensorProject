'use client'

import { useEffect, useState } from 'react'
import { workspaceService } from '@/services/workspace'
import { workspaceSlotNote } from '@/lib/workspace-limits'
import type { WorkspaceQuotaItem } from '@/types'

/**
 * MODEL-SERVE-041. How many workspaces the caller owns against their plan,
 * read when a create-workspace form opens. `note` is why Create is disabled,
 * or null — including while loading or if the read fails, so a hiccup never
 * blocks a create (the backend still refuses a real overrun with a 409).
 */
export function useMyWorkspaceQuota(enabled = true) {
  const [quota, setQuota] = useState<WorkspaceQuotaItem | null>(null)
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    workspaceService
      .getMyWorkspaceQuota()
      .then(res => {
        if (!cancelled) setQuota(res.data.workspaces)
      })
      .catch(() => {
        if (!cancelled) setQuota(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return { quota, loading, note: workspaceSlotNote(quota) }
}
