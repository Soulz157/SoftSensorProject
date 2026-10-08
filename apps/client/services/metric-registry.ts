import { fetchClient } from '@/lib/fetcher'

/**
 * MODEL-SERVE-006-T08 (Pass B). Static registry metadata — which metric
 * names exist and whether each is backfillable — mirrors `apps/backend`'s
 * `lib/metric-registry.ts` exactly. No modelId, no per-model state.
 */

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

export interface MetricRegistryEntry {
  key: 'r2' | 'rmse' | 'mae' | 'sd'
  label: string
  hint: string
  backfillable: boolean
}

export const metricRegistryService = {
  async getRegistry(): Promise<MetricRegistryEntry[]> {
    const res: ApiResponse<MetricRegistryEntry[]> = await fetchClient(
      '/api/v1/authorized/metrics/registry',
    )
    return res.data
  },
}
