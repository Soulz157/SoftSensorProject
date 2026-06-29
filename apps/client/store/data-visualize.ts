import { atom } from 'jotai'
import type { PiTagMeta, TimeRange } from '@/lib/mock-readings'
import type { Dataset, FillStrategyConfig } from '@/lib/preprocessing'
import {
  MOCK_DATA_SOURCES,
  type SavedDataSource,
} from '@/lib/mock-data-sources'

export type { SavedDataSource }

export const TOTAL_WIZARD_STEPS = 7

export type FetchStatus = 'idle' | 'fetching' | 'done' | 'error'

export interface FetchState {
  status: FetchStatus
  progress: number
  error?: string
}

/** Per-tag status returned by the PI tag-list (catalog) discovery call. */
export type TagDiscoveryStatus = 'fetching' | 'complete' | 'error'

/** A tag discovered from the PI server, with its live discovery status. */
export interface DiscoveredTag {
  piTag: string
  label: string
  description: string
  unit: string
  chartIndex: PiTagMeta['chartIndex']
  status: TagDiscoveryStatus
}

const EMPTY_DATASET: Dataset = { tags: [], rows: [] }

/** Selected data-source kind for wizard Step 2. '' = nothing picked yet. */
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

export const workspaceIdAtom = atom<string>('')
export const plantIdAtom = atom<string>('')
export const dataSourceAtom = atom<DataSourceType>('')
export const dataSourceCredentialsAtom = atom<DataSourceCredentials | null>(
  null,
)
export const customDateRangeAtom = atom<CustomDateRange | null>(null)
export const piServerIdAtom = atom<string>('')
export const tagListAtom = atom<DiscoveredTag[]>([])
export const selectedTagsAtom = atom<string[]>([])
export const timeRangeAtom = atom<TimeRange>('24h')
export const fetchStateAtom = atom<FetchState>({ status: 'idle', progress: 0 })
export const rawDatasetAtom = atom<Dataset>(EMPTY_DATASET)
export const fillStrategiesAtom = atom<Record<string, FillStrategyConfig>>({})
export const currentStepAtom = atom<number>(1)
export const highestUnlockedAtom = atom<number>(1)
export const selectedModelIdAtom = atom<string>('')
export const savedDataSourcesAtom = atom<SavedDataSource[]>(MOCK_DATA_SOURCES)
export const selectedSavedSourceIdAtom = atom<string>('')
