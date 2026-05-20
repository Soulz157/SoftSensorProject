import { useState } from 'react'
import { useAtom } from 'jotai'
import { workspacesAtom } from '@/store/workspace'
import type { UpdateWorkspacePayload } from '@/types'

export function useUpdateWorkspace() {
  const [isUpdating, setIsUpdating] = useState(false)
  const [, setWorkspaces] = useAtom(workspacesAtom)

  const updateWorkspace = async (id: string, data: UpdateWorkspacePayload) => {
    setIsUpdating(true)
    try {
      setWorkspaces(prev =>
        prev.map(w => (w.id === id ? { ...w, ...data } : w)),
      )
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      setIsUpdating(false)
    }
  }

  return { updateWorkspace, isUpdating }
}
