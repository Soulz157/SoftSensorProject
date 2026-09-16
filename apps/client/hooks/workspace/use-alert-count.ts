'use client'
import { useAtomValue } from 'jotai'
import { workspacesAtom } from '@/store/workspace'
import { useAllModels } from '@/hooks/use-all-models'
import { failedDeploys, monitoringAlerts } from '@/lib/model-status'

export function useAlertCount(): number {
  const workspaces = useAtomValue(workspacesAtom)
  const { models } = useAllModels()
  const alarmCount = workspaces.reduce(
    (sum, ws) => sum + (ws.alarmCount ?? 0),
    0,
  )
  const failedCount = failedDeploys(models ?? []).length
  // MODEL-SERVE-001-T30. Counted SEPARATELY and then summed, not folded into
  // `failedDeploys`: the two axes mean different things, and since T26 a dead
  // source lands only in this second term. Without it the nav badge undercounts
  // exactly the failure class T26 moved.
  const monitoringCount = monitoringAlerts(models ?? []).length
  return alarmCount + failedCount + monitoringCount
}
