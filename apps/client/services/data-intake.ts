import { fetchClient } from '@/lib/fetcher'
import type {
  AllWorkspacesIntake,
  IntakeRange,
  WorkspaceIntake,
} from '@/types/data-intake'

export const dataIntakeService = {
  getWorkspace: (
    workspaceId: string,
    range: IntakeRange,
  ): Promise<{ data: WorkspaceIntake }> =>
    fetchClient(
      `/api/v1/authorized/workspace/${workspaceId}/data-intake?range=${range}`,
      { method: 'GET' },
    ),

  /** Admin only. */
  getAll: (range: IntakeRange): Promise<{ data: AllWorkspacesIntake }> =>
    fetchClient(`/api/v1/admin/workspace/data-intake?range=${range}`, {
      method: 'GET',
    }),
}
