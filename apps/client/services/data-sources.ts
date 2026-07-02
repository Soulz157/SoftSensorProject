import { fetchClient } from '@/lib/fetcher'
import type { SavedDataSource } from '@/lib/mock-data-sources'

export interface CreateDataSourceInput {
  name: string
  type: string
  host: string
  username: string
  password: string
  dbName: string
}

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
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
}
