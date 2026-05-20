'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { useAtom } from 'jotai'
import { workspacesAtom } from '@/store/workspace'
import { workspaceService } from '@/services/workspace'
import type { Workspace } from '@/types'

export function useWorkspaces() {
  const { status } = useSession()
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = (await workspaceService.getWorkspaces()) as {
        data: Workspace[]
      }
      setWorkspaces(data.data)
    } catch (e) {
      const message = 'Failed to load workspaces'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [setWorkspaces])

  useEffect(() => {
    if (status === 'loading') return
    if (status === 'unauthenticated') {
      setLoading(false)
      setWorkspaces([])
    } else {
      fetchWorkspaces()
    }
  }, [fetchWorkspaces, status, setWorkspaces])

  return { workspaces, loading, error, refetch: fetchWorkspaces }
}
