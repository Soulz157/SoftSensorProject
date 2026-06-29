'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import { workspacePlantsAtom } from '@/store/workspace'
import {
  getWorkspacePlants,
  createWorkspacePlant,
  updateWorkspacePlant,
  deleteWorkspacePlant,
} from '@/services/workspace-plant'
import type { WorkspacePlant } from '@/types'

export function useWorkspacePlants(workspaceId: string | null) {
  const [plants, setPlants] = useAtom(workspacePlantsAtom)

  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loading = isFetching && (plants === null || plants.length === 0)

  const refetch = useCallback(async () => {
    if (!workspaceId) {
      setPlants([])
      return
    }

    setIsFetching(true)
    setError(null)
    try {
      const data = await getWorkspacePlants(workspaceId)
      setPlants(data)
    } catch {
      setError('Failed to load plants')
      toast.error('Failed to reload plants')
    } finally {
      setIsFetching(false)
    }
  }, [workspaceId, setPlants])

  useEffect(() => {
    if (!workspaceId) {
      setPlants([])
      return
    }

    let ignore = false

    const fetchPlants = async () => {
      setIsFetching(true)
      setError(null)

      try {
        const data = await getWorkspacePlants(workspaceId)
        if (!ignore) {
          setPlants(data)
          setIsFetching(false)
        }
      } catch {
        if (!ignore) {
          setError('Failed to load plants')
          setIsFetching(false)
        }
      }
    }

    void fetchPlants()

    return () => {
      ignore = true
    }
  }, [workspaceId, setPlants])

  const createPlan = useCallback(
    async (
      dto: Pick<WorkspacePlant, 'name' | 'icon' | 'color' | 'description'>,
    ) => {
      if (!workspaceId) return
      try {
        const newPlan = await createWorkspacePlant(workspaceId, dto)
        setPlants(prev => [...(prev || []), newPlan])
        return newPlan
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
        setPlants(prev =>
          (prev || []).map(p => (p.id === planId ? updated : p)),
        )
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
        setPlants(prev => (prev || []).filter(p => p.id !== planId))
      } catch {
        toast.error('Failed to delete plant')
      }
    },
    [setPlants],
  )

  return {
    plants,
    loading,
    isFetching,
    error,
    refetch,
    createPlan,
    updatePlan,
    deletePlan,
  }
}
