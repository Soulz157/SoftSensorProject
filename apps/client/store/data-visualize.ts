/**
 * Shared data-pipeline types.
 *
 * NAME IS HISTORICAL. This module outlived the /data-visualize page it was
 * named for — that route was removed on 2026-09-17 and its 18 atoms went with
 * it. What remains is pure type vocabulary that 15 files across the dataset,
 * model-pipeline and holdout code still import (CustomDateRange, FetchState,
 * DiscoveredTag, TagDiscoveryStatus, DataSourceType, DataSourceCredentials).
 * The filename was kept deliberately: renaming it would churn every importer
 * for no behavioural gain.
 */
import type { PiTagMeta } from '@/lib/mock-readings'
import type { SavedDataSource } from '@/lib/mock-data-sources'

export type { SavedDataSource }

export type FetchStatus = 'idle' | 'fetching' | 'done' | 'error'

export interface FetchState {
  status: FetchStatus
  progress: number
  error?: string
}

/** Per-tag status returned by the PI tag-list (catalog) discovery call. */
export type TagDiscoveryStatus = 'fetching' | 'complete' | 'error'

export type TabStatus =
  | 'no-tags'
  | 'pending'
  | 'loading'
  | 'ready'
  | 'unavailable'

/** A tag discovered from the PI server, with its live discovery status. */
export interface DiscoveredTag {
  piTag: string
  label: string
  description: string
  unit: string
  chartIndex: PiTagMeta['chartIndex']
  status: TagDiscoveryStatus
}

/** Selected data-source kind. '' = nothing picked yet. */
export type DataSourceType = '' | 'aveva' | 'sql' | 'csv' | 'api'

export interface DataSourceCredentials {
  host: string
  username: string
  password: string
  dbName: string
}

export interface CustomDateRange {
  from: string
  to: string
}
