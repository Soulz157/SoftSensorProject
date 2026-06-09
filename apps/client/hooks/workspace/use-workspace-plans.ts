'use client'
import { useAtom } from 'jotai'
import { useCallback, useEffect, useState } from 'react'
import { workspacePlansAtom } from '@/store/workspace'
import {
  getWorkspacePlans,
  createWorkspacePlan,
  updateWorkspacePlan,
  deleteWorkspacePlan,
} from '@/services/workspace-plan'
import type { WorkspacePlan } from '@/types'
import { toast } from 'sonner'

export function useWorkspacePlans(workspaceId: string | null) {
  const [plans, setPlans] = useAtom(workspacePlansAtom)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const data = await getWorkspacePlans(workspaceId)
      setPlans(data)
      setError(null)
    } catch {
      setError('Failed to load plans')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, setPlans])

  useEffect(() => {
    void refetch()
  }, [refetch])

  const createPlan = useCallback(
    async (
      dto: Pick<WorkspacePlan, 'name' | 'icon' | 'color' | 'description'>,
    ) => {
      if (!workspaceId) return
      try {
        const plan = await createWorkspacePlan(workspaceId, dto)
        setPlans(prev => [...prev, plan])
        return plan
      } catch {
        toast.error('Failed to create plan')
      }
    },
    [workspaceId, setPlans],
  )

  const updatePlan = useCallback(
    async (
      planId: string,
      dto: Partial<
        Pick<WorkspacePlan, 'name' | 'icon' | 'color' | 'description'>
      >,
    ) => {
      try {
        const updated = await updateWorkspacePlan(planId, dto)
        setPlans(prev => prev.map(p => (p.id === planId ? updated : p)))
        return updated
      } catch {
        toast.error('Failed to update plan')
      }
    },
    [setPlans],
  )

  const deletePlan = useCallback(
    async (planId: string) => {
      try {
        await deleteWorkspacePlan(planId)
        setPlans(prev => prev.filter(p => p.id !== planId))
      } catch {
        toast.error('Failed to delete plan')
      }
    },
    [setPlans],
  )

  return { plans, loading, error, refetch, createPlan, updatePlan, deletePlan }
}
