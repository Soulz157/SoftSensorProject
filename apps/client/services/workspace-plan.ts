import { fetchClient } from '@/lib/fetcher'
import type { WorkspacePlan } from '@/types'

export async function getWorkspacePlans(
  workspaceId: string,
): Promise<WorkspacePlan[]> {
  const res: { data: WorkspacePlan[] } = await fetchClient(
    `/api/v1/authorized/workspace-plan?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: 'GET' },
  )
  return res.data
}

export async function createWorkspacePlan(
  workspaceId: string,
  dto: Pick<WorkspacePlan, 'name' | 'icon' | 'color' | 'description'>,
): Promise<WorkspacePlan> {
  const res: { data: WorkspacePlan } = await fetchClient(
    `/api/v1/authorized/workspace-plan/${encodeURIComponent(workspaceId)}`,
    {
      method: 'POST',
      body: JSON.stringify(dto),
    },
  )
  return res.data
}

export async function updateWorkspacePlan(
  planId: string,
  dto: Partial<Pick<WorkspacePlan, 'name' | 'icon' | 'color' | 'description'>>,
): Promise<WorkspacePlan> {
  const res: { data: WorkspacePlan } = await fetchClient(
    `/api/v1/authorized/workspace-plan/${encodeURIComponent(planId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(dto),
    },
  )
  return res.data
}

export async function deleteWorkspacePlan(planId: string): Promise<void> {
  await fetchClient(`/api/v1/authorized/workspace-plan`, {
    method: 'DELETE',
    body: JSON.stringify({ planId }),
  })
}
