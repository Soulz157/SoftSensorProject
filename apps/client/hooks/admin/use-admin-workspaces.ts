'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { workspaceService } from '@/services/workspace'
import type { AdminWorkspace, Paginated } from '@/types'

interface UseAdminWorkspacesOptions {
  page: number
  limit: number
  search?: string
}

export function useAdminWorkspaces({
  page,
  limit,
  search,
}: UseAdminWorkspacesOptions) {
  const { status } = useSession()
  const [data, setData] = useState<Paginated<AdminWorkspace> | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setIsFetching(true)
    setError(null)
    try {
      const res = await workspaceService.getAdminWorkspaces({
        page,
        limit,
        search,
      })
      setData(res.data)
    } catch {
      const message = 'Failed to load workspaces'
      setError(message)
      toast.error(message)
    } finally {
      setIsFetching(false)
    }
  }, [page, limit, search])

  useEffect(() => {
    if (status === 'loading') return
    queueMicrotask(() => {
      if (status !== 'authenticated') return
      fetchData()
    })
  }, [fetchData, status])

  return {
    data,
    loading: isFetching && data === null,
    isFetching,
    error,
    refetch: fetchData,
  }
}
