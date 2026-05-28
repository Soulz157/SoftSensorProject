import { fetchClient } from '@/lib/fetcher'
import type { AdminUser, Paginated, UserRole } from '@/types'

function buildQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export const userService = {
  getAdminUsers: (params: {
    page?: number
    limit?: number
    search?: string
    role?: string
    status?: string
  }): Promise<{ data: Paginated<AdminUser> }> => {
    const query = buildQuery({
      page: params.page,
      limit: params.limit,
      search: params.search,
      role: params.role,
      status: params.status,
    })
    return fetchClient(`/api/v1/auth/admin/users${query}`, { method: 'GET' })
  },

  updateUserRole: (userId: string, role: UserRole): Promise<unknown> =>
    fetchClient(`/api/v1/auth/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  toggleBlockUser: (userId: string): Promise<unknown> =>
    fetchClient(`/api/v1/auth/admin/users/${userId}/block`, {
      method: 'PATCH',
    }),

  deleteUser: (userId: string): Promise<unknown> => {
    return fetchClient(`/api/v1/auth/admin/users/delete`, {
      method: 'DELETE',
      body: JSON.stringify({ id: userId }),
    })
  },
}
