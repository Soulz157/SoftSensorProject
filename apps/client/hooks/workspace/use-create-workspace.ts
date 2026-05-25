'use client'

import { useState } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { workspacesAtom } from '@/store/workspace'
import { workspaceService } from '@/services/workspace'
import type { CreateWorkspaceInput } from '@/types'

export function useCreateWorkspace() {
  const setWorkspaces = useSetAtom(workspacesAtom)
  const [isCreating, setIsCreating] = useState(false)

  const createWorkspace = async (data: CreateWorkspaceInput) => {
    setIsCreating(true)
    try {
      const workspace = await workspaceService.createWorkspace(data)
      setWorkspaces(prev => [...prev, workspace])
      return { success: true, workspace }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'สร้าง workspace ไม่สำเร็จ'
      toast.error('สร้าง workspace ไม่สำเร็จ', { description: message })
      return { success: false }
    } finally {
      setIsCreating(false)
    }
  }

  return { createWorkspace, isCreating }
}
