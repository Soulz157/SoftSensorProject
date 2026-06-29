'use client'
import { useAtomValue } from 'jotai'
import { workspacesAtom } from '@/store/workspace'
import { useAllModels } from '@/hooks/use-all-models'
import { failedDeploys } from '@/lib/model-status'

export function useAlertCount(): number {
  const workspaces = useAtomValue(workspacesAtom)
  const { models } = useAllModels()
  const alarmCount = workspaces.reduce(
    (sum, ws) => sum + (ws.alarmCount ?? 0),
    0,
  )
  const failedCount = failedDeploys(models ?? []).length
  return alarmCount + failedCount
}
