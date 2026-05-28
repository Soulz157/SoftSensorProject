'use client'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { workspaceService } from '@/services/workspace'
import type { WorkspaceDetail } from '@/types'

export function useWorkspace(id: string) {
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchWorkspace = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await workspaceService.getWorkspaceById(id)
      setWorkspace(res.data)
    } catch {
      const message = 'Failed to load workspace'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchWorkspace()
  }, [fetchWorkspace])

  return { workspace, loading, error, refetch: fetchWorkspace }
}
