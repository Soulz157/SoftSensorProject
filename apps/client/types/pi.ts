/**
 * TypeScript mirror of the FastAPI PI service contract.
 * Source of truth: apps/python/schemas/data.py — keep in sync.
 */

export type CalBasis =
  | 'TimeWeighted'
  | 'EventWeighted'
  | 'TimeWeightedContinuous'

export type SummaryType =
  | 'Average'
  | 'Minimum'
  | 'Maximum'
  | 'Total'
  | 'StdDev'
  | 'Count'

export type TagStatus = 'ok' | 'partial' | 'failed'

export interface TagItem {
  tag_name: string
  description?: string | null
  unit?: string | null
  plant?: string | null
}

export interface TagListResponse {
  total: number
  tags: TagItem[]
}

export interface DataFetchRequest {
  tag_list: string[]
  start_time: string // "YYYY-MM-DD HH:mm:ss.SSSSSS"
  end_time: string
  cal_basis?: CalBasis
  summary_type?: SummaryType[]
  summary_duration?: string | null
  batch_size?: number // 1..1000, default 300
}

export interface TagDataPoint {
  timestamp: string
  value: number | string | null
}

export interface TagDataResult {
  tag_name: string
  data: TagDataPoint[]
  status: TagStatus
  error?: string | null
}

export interface DataFetchResponse {
  start_time: string
  end_time: string
  total_tags: number
  succeeded_tags: number
  failed_tags: number
  batch_size: number
  results: TagDataResult[]
}

export interface PiHealth {
  connected: boolean
  server?: string
  detail?: string
}

export interface TagSearchParams {
  name_filter?: string
  max_count?: number
}
