'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { workspaceService } from '@/services/workspace'
import type { WorkspaceDetail, WorkspaceMember } from '@/types'

export function useWorkspaceSettings(workspaceId: string) {
  const { status } = useSession()
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [selectedIcon, setSelectedIcon] = useState('')
  const [selectedColor, setSelectedColor] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [wsRes, membersRes] = await Promise.all([
        workspaceService.getWorkspaceById(workspaceId),
        workspaceService.listMembers(workspaceId),
      ])
      setWorkspace(wsRes.data)
      setName(wsRes.data.name)
      setSelectedIcon(wsRes.data.icon)
      setSelectedColor(wsRes.data.color)
      setMembers(membersRes.data)
    } catch {
      toast.error('Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (status === 'loading') return
    queueMicrotask(() => {
      if (status !== 'authenticated') return
      loadData()
    })
  }, [loadData, status])

  return {
    workspace,
    members,
    setMembers,
    loading,
    name,
    setName,
    selectedIcon,
    setSelectedIcon,
    selectedColor,
    setSelectedColor,
    refetch: loadData,
  }
}
