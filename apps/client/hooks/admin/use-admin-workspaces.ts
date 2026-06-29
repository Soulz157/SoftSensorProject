'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePaginatedFetch } from '@/hooks/use-paginated-fetch'
import { workspaceService } from '@/services/workspace'
import type { AdminWorkspace } from '@/types'
import { toast } from 'sonner'

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
  return usePaginatedFetch<AdminWorkspace>(
    () => workspaceService.getAdminWorkspaces({ page, limit, search }),
    [page, limit, search],
    'Failed to load workspaces',
  )
}

export function useAdminAllWorkspaces() {
  const [data, setData] = useState<AdminWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await workspaceService.getAdminAllWorkspaces()

      const result = Array.isArray(response) ? response : (response?.data ?? [])
      setData(result.items)
    } catch {
      toast.error('Failed to load workspaces')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      fetchWorkspaces()
    })
  }, [fetchWorkspaces])

  return { data, loading, error, refetch: fetchWorkspaces }
}
