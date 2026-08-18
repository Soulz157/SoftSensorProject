import { fetchClient } from '@/lib/fetcher'
import type { SavedDataset } from '@/store/datasets'
import type { PipelineConfig } from '@/lib/pipeline-config'

export interface CreateDatasetInput {
  name: string
  description?: string
  workspaceId: string
  sourceIds: string[]
  tags: string[]
  pipelineConfig: PipelineConfig
  fileUrl?: string | null
  rowCount: number
  missingPct: number
}

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

export const datasetService = {
  list: (workspaceId?: string): Promise<ApiResponse<SavedDataset[]>> =>
    fetchClient(
      `/api/v1/authorized/dataset${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`,
      { method: 'GET' },
    ),

  get: (id: string): Promise<ApiResponse<SavedDataset>> =>
    fetchClient(`/api/v1/authorized/dataset/${id}`, { method: 'GET' }),

  create: (body: CreateDatasetInput): Promise<ApiResponse<SavedDataset>> =>
    fetchClient('/api/v1/authorized/dataset', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (
    id: string,
    body: Partial<CreateDatasetInput>,
  ): Promise<ApiResponse<SavedDataset>> =>
    fetchClient(`/api/v1/authorized/dataset/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (id: string): Promise<ApiResponse<null>> =>
    fetchClient(`/api/v1/authorized/dataset/${id}`, { method: 'DELETE' }),
}
