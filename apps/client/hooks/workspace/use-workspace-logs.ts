'use client'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { workspaceService } from '@/services/workspace'
import type { WorkspaceLog } from '@/types'

const PAGE_LIMIT = 10

export function useWorkspaceLogs(workspaceId: string) {
  const [logs, setLogs] = useState<WorkspaceLog[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchLogs = useCallback(
    async (p: number) => {
      if (!workspaceId) return
      setIsFetching(true)
      setError(null)
      try {
        const res = await workspaceService.getWorkspaceLogs(workspaceId, {
          page: p,
          limit: PAGE_LIMIT,
        })
        setLogs(res.data.items)
        setTotal(res.data.total)
      } catch {
        const message = 'Failed to load activity logs'
        setError(message)
        toast.error(message)
      } finally {
        setIsFetching(false)
      }
    },
    [workspaceId],
  )

  useEffect(() => {
    fetchLogs(page)
  }, [fetchLogs, page])

  const loading = isFetching && logs === null
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  return {
    logs,
    total,
    page,
    totalPages,
    loading,
    isFetching,
    error,
    setPage,
    refetch: () => fetchLogs(page),
  }
}
