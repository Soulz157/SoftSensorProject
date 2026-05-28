import { useState } from 'react'
import { useSetAtom } from 'jotai'
import { workspacesAtom } from '@/store/workspace'
import { workspaceService } from '@/services/workspace'

export function useDeleteWorkspace() {
  const [isDeleting, setIsDeleting] = useState(false)
  const setWorkspaces = useSetAtom(workspacesAtom)

  const deleteWorkspace = async (id: string) => {
    setIsDeleting(true)
    try {
      await workspaceService.deleteWorkspace(id)
      setWorkspaces(prev => prev.filter(w => w.id !== id))
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      setIsDeleting(false)
    }
  }

  return { deleteWorkspace, isDeleting }
}
