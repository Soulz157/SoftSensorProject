'use client'
import { useAtomValue } from 'jotai'
import { workspacesAtom } from '@/store/workspace'

export function useAlertCount(): number {
  const workspaces = useAtomValue(workspacesAtom)
  return workspaces.reduce((sum, ws) => sum + (ws.alarmCount ?? 0), 0)
}
