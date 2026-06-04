'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { workspaceService } from '@/services/workspace'
import type { AdminWorkspaceDetail, WorkspaceMember } from '@/types'

export function useAdminWorkspaceSettings(workspaceId: string) {
  const { status } = useSession()
  const [workspace, setWorkspace] = useState<AdminWorkspaceDetail | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedIcon, setSelectedIcon] = useState('')
  const [selectedColor, setSelectedColor] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await workspaceService.getAdminWorkspaceById(workspaceId)
      setWorkspace(res.data)
      setName(res.data.name)
      setDescription(res.data.description ?? '')
      setSelectedIcon(res.data.icon)
      setSelectedColor(res.data.color)
      setMembers(res.data.members)
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
    description,
    setDescription,
    selectedIcon,
    setSelectedIcon,
    selectedColor,
    setSelectedColor,
    refetch: loadData,
  }
}
