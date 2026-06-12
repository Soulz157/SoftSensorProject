import { fetchClient } from '@/lib/fetcher'
import type {
  AdminWorkspace,
  AdminWorkspaceDetail,
  CreateWorkspaceInput,
  Paginated,
  UpdateWorkspacePayload,
  Workspace,
  WorkspaceDetail,
  WorkspaceLog,
  WorkspaceMember,
  WorkspaceModel,
  WorkspaceRole,
} from '@/types'

function buildQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export const workspaceService = {
  getWorkspaces: () =>
    fetchClient('/api/v1/authorized/workspace', { method: 'GET' }),
  getAllWorkspaces: () =>
    fetchClient('/api/v1/authorized/workspace/all', { method: 'GET' }),

  getWorkspaceById: (id: string): Promise<{ data: WorkspaceDetail }> =>
    fetchClient(`/api/v1/authorized/workspace/${id}`, { method: 'GET' }),

  getWorkspaceModels: (id: string): Promise<{ data: WorkspaceModel[] }> =>
    fetchClient(`/api/v1/authorized/workspace/${id}/models`, { method: 'GET' }),

  getWorkspaceLogs: (
    id: string,
    params?: { page?: number; limit?: number },
  ): Promise<{ data: Paginated<WorkspaceLog> }> => {
    const query = buildQuery({ page: params?.page, limit: params?.limit })
    return fetchClient(`/api/v1/authorized/workspace/${id}/logs${query}`, {
      method: 'GET',
    })
  },
  getAdminAllWorkspaces: () =>
    fetchClient('/api/v1/admin/workspace', { method: 'GET' }),

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
    const res = await fetchClient(`/api/v1/authorized/workspace/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
    return res.data
  },

  adminUpdateworkspace: async (
    id: string,
    data: UpdateWorkspacePayload,
  ): Promise<Omit<AdminWorkspaceDetail, 'modelsCount'>> => {
    const res = await fetchClient(`/api/v1/admin/workspace/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
    return res.data
  },

  deleteWorkspace: async (workspaceId: string): Promise<void> => {
    await fetchClient(`/api/v1/authorized/workspace/delete`, {
      method: 'DELETE',
      body: JSON.stringify({ workspaceId }),
    })
  },

  getAdminWorkspaces: (params: {
    page?: number
    limit?: number
    search?: string
  }): Promise<{ data: Paginated<AdminWorkspace> }> => {
    const query = buildQuery({
      page: params.page,
      limit: params.limit,
      search: params.search,
    })
    return fetchClient(`/api/v1/admin/workspace${query}`, { method: 'GET' })
  },

  listMembers: (workspaceId: string): Promise<{ data: WorkspaceMember[] }> =>
    fetchClient(`/api/v1/authorized/workspace/${workspaceId}/members`, {
      method: 'GET',
    }),

  inviteMember: (
    workspaceId: string,
    email: string,
    role: WorkspaceRole,
  ): Promise<{ data: WorkspaceMember }> =>
    fetchClient(`/api/v1/authorized/workspace/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  updateMemberRole: (
    workspaceId: string,
    memberId: string,
    role: WorkspaceRole,
  ): Promise<{ data: WorkspaceMember }> =>
    fetchClient(
      `/api/v1/authorized/workspace/${workspaceId}/members/${memberId}`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    ),

  removeMember: (workspaceId: string, memberId: string): Promise<unknown> =>
    fetchClient(
      `/api/v1/authorized/workspace/${workspaceId}/members/${memberId}`,
      { method: 'DELETE', body: JSON.stringify({ memberId }) },
    ),

  getAdminWorkspaceById: (
    id: string,
  ): Promise<{ data: AdminWorkspaceDetail }> =>
    fetchClient(`/api/v1/admin/workspace/${id}`, { method: 'GET' }),

  adminInviteMember: (
    workspaceId: string,
    email: string,
    role: WorkspaceRole,
  ): Promise<{ data: WorkspaceMember }> =>
    fetchClient(`/api/v1/admin/workspace/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  adminUpdateMemberRole: (
    workspaceId: string,
    memberId: string,
    role: WorkspaceRole,
  ): Promise<{ data: WorkspaceMember }> =>
    fetchClient(`/api/v1/admin/workspace/${workspaceId}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  adminRemoveMember: (
    workspaceId: string,
    memberId: string,
  ): Promise<unknown> =>
    fetchClient(`/api/v1/admin/workspace/${workspaceId}/members/${memberId}`, {
      method: 'DELETE',
    }),

  uploadWorkspaceThumbnail: async (
    id: string,
    file: File,
  ): Promise<{ data: { thumbnailUrl: string } }> => {
    const { getSession } = await import('next-auth/react')
    const session = await getSession()
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/authorized/workspace/${id}/thumbnail`,
      {
        method: 'POST',
        body: formData,
        headers: session?.user?.accessToken
          ? { Authorization: `Bearer ${session.user.accessToken}` }
          : {},
      },
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(
        (err as { message?: string }).message ?? `Upload failed: ${res.status}`,
      )
    }
    return res.json()
  },
}
