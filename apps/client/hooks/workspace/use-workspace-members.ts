'use client'

import { useCallback, useEffect, useState } from 'react'
import { workspaceService } from '@/services/workspace'
import type { WorkspaceMember } from '@/types'

export function useWorkspaceMembers(
  workspaceId: string,
  currentUserId: string | undefined,
) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)

  const isOwner = members.some(
    m => m.userId === currentUserId && m.role === 'OWNER',
  )

  const fetchMembers = useCallback(async () => {
    setIsFetching(true)
    try {
      const res = await workspaceService.listMembers(workspaceId)
      setMembers(res.data ?? [])
    } catch {
    } finally {
      setIsFetching(false)
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    setLoading(true)
    setMembers([])
    fetchMembers()
  }, [fetchMembers])

  return { members, loading, isFetching, isOwner, fetchMembers }
}
