import { fetchClient } from '@/lib/fetcher'
import type { WorkspacePlant } from '@/types'

export async function getWorkspacePlants(
  workspaceId: string,
): Promise<WorkspacePlant[]> {
  const res: { data: WorkspacePlant[] } = await fetchClient(
    `/api/v1/authorized/workspace-plant?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: 'GET' },
  )
  return res.data
}

export async function createWorkspacePlant(
  workspaceId: string,
  dto: Pick<WorkspacePlant, 'name' | 'icon' | 'color' | 'description'>,
): Promise<WorkspacePlant> {
  const res: { data: WorkspacePlant } = await fetchClient(
    `/api/v1/authorized/workspace-plant/${encodeURIComponent(workspaceId)}`,
    {
      method: 'POST',
      body: JSON.stringify(dto),
    },
  )
  return res.data
}

export async function updateWorkspacePlant(
  planId: string,
  dto: Partial<Pick<WorkspacePlant, 'name' | 'icon' | 'color' | 'description'>>,
): Promise<WorkspacePlant> {
  const res: { data: WorkspacePlant } = await fetchClient(
    `/api/v1/authorized/workspace-plant/${encodeURIComponent(planId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(dto),
    },
  )
  return res.data
}

export async function deleteWorkspacePlant(planId: string): Promise<void> {
  await fetchClient(`/api/v1/authorized/workspace-plant`, {
    method: 'DELETE',
    body: JSON.stringify({ planId }),
  })
}
