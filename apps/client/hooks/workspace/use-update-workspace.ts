import { useState } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { workspacesAtom } from '@/store/workspace'
import { workspaceService } from '@/services/workspace'
import type { UpdateWorkspacePayload } from '@/types'

export function useUpdateWorkspace() {
  const [isUpdating, setIsUpdating] = useState(false)
  const setWorkspaces = useSetAtom(workspacesAtom)

  const updateWorkspace = async (id: string, data: UpdateWorkspacePayload) => {
    setIsUpdating(true)
    try {
      const updated = await workspaceService.updateWorkspace(id, data)
      setWorkspaces(prev =>
        prev.map(w =>
          w.id === id
            ? {
                ...w,
                ...updated,
                description: updated.description ?? undefined,
              }
            : w,
        ),
      )
      return { success: true }
    } catch (error) {
      toast.error('อัปเดต workspace ไม่สำเร็จ')
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

export function useAdminUpdateWorkspace() {
  const [isUpdating, setIsUpdating] = useState(false)
  const setWorkspaces = useSetAtom(workspacesAtom)

  const adminUpdateWorkspace = async (
    id: string,
    data: UpdateWorkspacePayload,
  ) => {
    setIsUpdating(true)
    try {
      const updated = await workspaceService.adminUpdateworkspace(id, data)
      setWorkspaces(prev =>
        prev.map(w =>
          w.id === id
            ? {
                ...w,
                ...updated,
                description: updated.description ?? undefined,
              }
            : w,
        ),
      )
      return { success: true }
    } catch (error) {
      toast.error('อัปเดต workspace ไม่สำเร็จ')
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      setIsUpdating(false)
    }
  }

  return { adminUpdateWorkspace, isUpdating }
}
