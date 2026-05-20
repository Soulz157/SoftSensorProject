import { fetchClient } from '@/lib/fetcher'
import type { CreateWorkspaceInput, UpdateWorkspacePayload } from '@/types'

export const workspaceService = {
  getWorkspaces: () =>
    fetchClient('/api/v1/authorized/workspace', { method: 'GET' }),

  createWorkspace: (data: CreateWorkspaceInput) =>
    fetchClient('/api/v1/authorized/workspace', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateWorkspace: (id: string, data: UpdateWorkspacePayload) =>
    fetchClient(`/api/v1/authorized/workspace/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}
