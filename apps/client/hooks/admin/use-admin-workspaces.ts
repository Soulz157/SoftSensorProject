'use client'

import { usePaginatedFetch } from '@/hooks/use-paginated-fetch'
import { workspaceService } from '@/services/workspace'
import type { AdminWorkspace } from '@/types'

interface UseAdminWorkspacesOptions {
  page: number
  limit: number
  search?: string
}

export function useAdminWorkspaces({
  page,
  limit,
  search,
}: UseAdminWorkspacesOptions) {
  return usePaginatedFetch<AdminWorkspace>(
    () => workspaceService.getAdminWorkspaces({ page, limit, search }),
    [page, limit, search],
    'Failed to load workspaces',
  )
}
