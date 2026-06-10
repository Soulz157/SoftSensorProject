'use client'
import { useAtom } from 'jotai'
import { useCallback, useEffect, useState } from 'react'
import { workspacePlantsAtom } from '@/store/workspace'
import {
  getWorkspacePlants,
  createWorkspacePlant,
  updateWorkspacePlant,
  deleteWorkspacePlant,
} from '@/services/workspace-plant'
import type { WorkspacePlant } from '@/types'
import { toast } from 'sonner'

export function useWorkspacePlants(workspaceId: string | null) {
  const [plants, setPlants] = useAtom(workspacePlantsAtom)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const data = await getWorkspacePlants(workspaceId)
      setPlants(data)
      setError(null)
    } catch {
      setError('Failed to load plants')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, setPlants])

  useEffect(() => {
    void refetch()
  }, [refetch])

  const createPlan = useCallback(
    async (
      dto: Pick<WorkspacePlant, 'name' | 'icon' | 'color' | 'description'>,
    ) => {
      if (!workspaceId) return
      try {
        const plan = await createWorkspacePlant(workspaceId, dto)
        setPlants(prev => [...prev, plan])
        return plan
      } catch {
        toast.error('Failed to create plant')
      }
    },
    [workspaceId, setPlants],
  )

  const updatePlan = useCallback(
    async (
      planId: string,
      dto: Partial<
        Pick<WorkspacePlant, 'name' | 'icon' | 'color' | 'description'>
      >,
    ) => {
      try {
        const updated = await updateWorkspacePlant(planId, dto)
        setPlants(prev => prev.map(p => (p.id === planId ? updated : p)))
        return updated
      } catch {
        toast.error('Failed to update plant')
      }
    },
    [setPlants],
  )

  const deletePlan = useCallback(
    async (planId: string) => {
      try {
        await deleteWorkspacePlant(planId)
        setPlants(prev => prev.filter(p => p.id !== planId))
      } catch {
        toast.error('Failed to delete plan')
      }
    },
    [setPlants],
  )

  return { plants, loading, error, refetch, createPlan, updatePlan, deletePlan }
}
