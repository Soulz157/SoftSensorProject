import { fetchClient } from '@/lib/fetcher'
import type {
  NotificationChannel,
  NotificationChannelKind,
  NotificationDelivery,
  NotificationEventItem,
  NotificationSeverity,
  Paginated,
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

export interface NotificationChannelInput {
  kind: NotificationChannelKind
  name: string
  target?: string
  recipientUserIds?: string[]
  enabled?: boolean
  minSeverity?: NotificationSeverity
  events?: string[]
  cooldownMinutes?: number
  mutedModelIds?: string[]
}

const base = (workspaceId: string) =>
  `/api/v1/authorized/workspace/${workspaceId}/notification-channel`

export const notificationService = {
  listChannels: (
    workspaceId: string,
  ): Promise<{
    data: { channels: NotificationChannel[]; knownEvents: string[] }
  }> => fetchClient(base(workspaceId), { method: 'GET' }),

  createChannel: (
    workspaceId: string,
    payload: NotificationChannelInput,
  ): Promise<{ data: { id: string; hasTarget: boolean } }> =>
    fetchClient(base(workspaceId), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateChannel: (
    workspaceId: string,
    channelId: string,
    payload: Partial<Omit<NotificationChannelInput, 'kind'>>,
  ): Promise<{ data: { id: string; hasTarget: boolean } }> =>
    fetchClient(`${base(workspaceId)}/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteChannel: (workspaceId: string, channelId: string): Promise<unknown> =>
    fetchClient(`${base(workspaceId)}/${channelId}`, { method: 'DELETE' }),

  testChannel: (
    workspaceId: string,
    channelId: string,
  ): Promise<{ data: { status: string; lastError: string | null } }> =>
    fetchClient(`${base(workspaceId)}/${channelId}/test`, { method: 'POST' }),

  listDeliveries: (
    workspaceId: string,
    channelId: string,
    params?: { page?: number; limit?: number },
  ): Promise<{ data: Paginated<NotificationDelivery> }> => {
    const query = buildQuery({ page: params?.page, limit: params?.limit })
    return fetchClient(`${base(workspaceId)}/${channelId}/deliveries${query}`, {
      method: 'GET',
    })
  },
}

/**
 * MODEL-SERVE-022-T08. The navbar bell's own API — cross-workspace (see the
 * controller's own doc comment for why the route is not workspace-scoped).
 */
export const notificationFeedService = {
  listEvents: (params?: {
    cursor?: string
    limit?: number
  }): Promise<{
    data: { items: NotificationEventItem[]; nextCursor: string | null }
  }> => {
    const query = buildQuery({ cursor: params?.cursor, limit: params?.limit })
    return fetchClient(`/api/v1/authorized/notifications${query}`, {
      method: 'GET',
    })
  },

  unreadCount: (): Promise<{
    data: { count: number; pollIntervalMs: number }
  }> =>
    fetchClient('/api/v1/authorized/notifications/unread-count', {
      method: 'GET',
    }),

  markRead: (upTo?: string): Promise<unknown> =>
    fetchClient('/api/v1/authorized/notifications/read', {
      method: 'POST',
      body: JSON.stringify(upTo ? { upTo } : {}),
    }),

  listMutes: (): Promise<{ data: { modelIds: string[] } }> =>
    fetchClient('/api/v1/authorized/notifications/mutes', { method: 'GET' }),

  muteModel: (modelId: string): Promise<unknown> =>
    fetchClient('/api/v1/authorized/notifications/mutes', {
      method: 'POST',
      body: JSON.stringify({ modelId }),
    }),

  unmuteModel: (modelId: string): Promise<unknown> =>
    fetchClient(`/api/v1/authorized/notifications/mutes/${modelId}`, {
      method: 'DELETE',
    }),
}
