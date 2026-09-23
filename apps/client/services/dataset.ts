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

  /**
   * DS-LAKE-030-T01. Read by the delete confirm dialog. Never blocks the
   * delete — the backend does not refuse on dependents, by decision D01.
   */
  dependents: (
    id: string,
  ): Promise<ApiResponse<{ models: DatasetDependentModel[] }>> =>
    fetchClient(`/api/v1/authorized/dataset/${id}/dependents`, {
      method: 'GET',
    }),
}

export interface DatasetDependentModel {
  id: string
  name: string
  /** The model's schedule is on — it is fetching and predicting right now. */
  scheduleEnabled: boolean
  hasProductionVersion: boolean
  /** Found through `Model.datasetId`: the model's CURRENT dataset pointer. */
  viaCurrentPointer: boolean
  /**
   * Found through a `ModelVersion.sourceDatasetId`: a version is PINNED to
   * this dataset. Can be true while `viaCurrentPointer` is false — a
   * retrained model points its current link elsewhere while an older
   * version, possibly the PRODUCTION one, stays pinned here.
   */
  viaPinnedVersion: boolean
}
