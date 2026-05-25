import { fetchClient } from '@/lib/fetcher'
import type {
  CreateWorkspaceInput,
  UpdateWorkspacePayload,
  Workspace,
} from '@/types'

export const workspaceService = {
  getWorkspaces: () =>
    fetchClient('/api/v1/authorized/workspace', { method: 'GET' }),

  createWorkspace: async (data: CreateWorkspaceInput): Promise<Workspace> => {
    const res = await fetchClient('/api/v1/admin/workspace/create', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    return { ...res.data, modelsCount: 0 }
  },

  updateWorkspace: async (
    id: string,
    data: UpdateWorkspacePayload,
  ): Promise<Omit<Workspace, 'modelsCount'>> => {
    const res = await fetchClient(`/api/v1/admin/workspace/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
    return res.data
  },
}
