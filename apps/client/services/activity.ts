import { fetchClient } from '@/lib/fetcher'
import type {
  ActivityLog,
  AuthAction,
  Paginated,
  UserActivityStats,
} from '@/types'

interface ActivityLogParams {
  page?: number
  limit?: number
  action?: AuthAction
  userId?: string
}

interface UserStatsParams {
  page?: number
  limit?: number
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export const activityService = {
  getActivityLog: (
    params: ActivityLogParams = {},
  ): Promise<{ data: Paginated<ActivityLog> }> => {
    const query = buildQuery({
      page: params.page,
      limit: params.limit,
      action: params.action,
      userId: params.userId,
    })
    return fetchClient(`/api/v1/auth/admin/activity-log${query}`, {
      method: 'GET',
    })
  },

  getUserStats: (
    params: UserStatsParams = {},
  ): Promise<{ data: Paginated<UserActivityStats> }> => {
    const query = buildQuery({
      page: params.page,
      limit: params.limit,
    })
    return fetchClient(`/api/v1/auth/admin/user-stats${query}`, {
      method: 'GET',
    })
  },
}
