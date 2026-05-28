'use client'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { workspaceService } from '@/services/workspace'
import type { WorkspaceModel } from '@/types'

export function useWorkspaceModels(workspaceId: string) {
  const [models, setModels] = useState<WorkspaceModel[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchModels = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    try {
      const res = await workspaceService.getWorkspaceModels(workspaceId)
      setModels(res.data)
    } catch {
      const message = 'Failed to load models'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  return { models, loading, error, refetch: fetchModels }
}
