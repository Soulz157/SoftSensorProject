'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { useAtom } from 'jotai'
import { workspacesAtom } from '@/store/workspace'
import { workspaceService } from '@/services/workspace'
import type { Workspace } from '@/types'
interface UseWorkspacesOptions {
  enabled?: boolean
}

export function useWorkspaces({ enabled = true }: UseWorkspacesOptions = {}) {
  const { status } = useSession()
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearWorkspaces = useCallback(() => {
    setLoading(false)
    setWorkspaces([])
  }, [setWorkspaces])

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = (await workspaceService.getWorkspaces()) as {
        data: Workspace[]
      }
      setWorkspaces(data.data)
    } catch {
      const message = 'Failed to load workspaces'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [setWorkspaces])

  useEffect(() => {
    if (!enabled) return
    if (status === 'loading') return

    queueMicrotask(() => {
      if (status !== 'authenticated') {
        clearWorkspaces()
      } else {
        fetchWorkspaces()
      }
    })
  }, [fetchWorkspaces, clearWorkspaces, status, enabled])

  return { workspaces, loading, error, refetch: fetchWorkspaces }
}
