import { fetchClient } from '@/lib/fetcher'
import type {
  SavedDataSource,
  DataSourceConfig,
  DataSourceKind,
} from '@/lib/mock-data-sources'

export interface CreateDataSourceInput {
  name: string
  type: string
  host: string
  username: string
  password: string
  dbName: string
  config?: DataSourceConfig
}

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
}

/** Current (snapshot) value + quality for one PI tag. */
export interface TagCurrent {
  tag_name: string
  value: number | string | null
  timestamp: string | null
  isGood: boolean | null
  questionable: boolean | null
  substituted: boolean | null
}

export interface TagCurrentResponse {
  tags: TagCurrent[]
}

/** Enriched PI tag metadata (no archive read) — mirrors Python TagItem. */
export interface TagMetaItem {
  tag_name: string
  description: string | null
  value: number | string | null
  unit: string | null
  point_type: string | null
  isGood: boolean | null
  questionable: boolean | null
  substituted: boolean | null
  timestamp: string | null
}

export interface TagMetadataResponse {
  total: number
  tags: TagMetaItem[]
}

/** Ad-hoc connection details for testing a source before it is saved. */
export interface AdHocSourceInput {
  type: DataSourceKind
  host: string
  username: string
  password: string
  dbName: string
  config?: DataSourceConfig
}

export const dataSourceService = {
  list: (): Promise<ApiResponse<SavedDataSource[]>> =>
    fetchClient('/api/v1/authorized/data-source', { method: 'GET' }),

  create: (
    body: CreateDataSourceInput,
  ): Promise<ApiResponse<SavedDataSource>> =>
    fetchClient('/api/v1/authorized/data-source', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (
    id: string,
    body: Partial<CreateDataSourceInput>,
  ): Promise<ApiResponse<SavedDataSource>> =>
    fetchClient(`/api/v1/authorized/data-source/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (id: string): Promise<ApiResponse<null>> =>
    fetchClient(`/api/v1/authorized/data-source/${id}`, { method: 'DELETE' }),

  /** Test a saved source's live connection. */
  testConnection: (id: string): Promise<ApiResponse<ConnectionTestResult>> =>
    fetchClient(`/api/v1/authorized/data-source/${id}/test-connection`, {
      method: 'POST',
    }),

  /** Test connection details before the source is saved. */
  testAdHoc: (
    body: AdHocSourceInput,
  ): Promise<ApiResponse<ConnectionTestResult>> =>
    fetchClient('/api/v1/authorized/data-source/test-connection', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Fetch raw rows from a saved source. `T` is the connector's response shape
   * (e.g. PI DataFetchResponse). Params are the connect-endpoint fetch DTO. */
  fetchData: <T>(
    id: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ApiResponse<T>> =>
    fetchClient(`/api/v1/authorized/data-source/${id}/fetch`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),

  /** Current (snapshot) values + quality for selected PI tags (no archive read). */
  tagsCurrent: (
    id: string,
    tagList: string[],
    batchSize?: number,
  ): Promise<ApiResponse<TagCurrentResponse>> =>
    fetchClient(`/api/v1/authorized/data-source/${id}/tags/current`, {
      method: 'POST',
      body: JSON.stringify({ tagList, ...(batchSize ? { batchSize } : {}) }),
    }),

  /** Browse tag metadata for a source (PI tag search) — metadata only, no archive. */
  metadata: (
    id: string,
    params?: { nameFilter?: string; maxCount?: number; table?: string },
  ): Promise<ApiResponse<TagMetadataResponse>> =>
    fetchClient(`/api/v1/authorized/data-source/${id}/metadata`, {
      method: 'POST',
      body: JSON.stringify(params ?? {}),
    }),
}
