import { atom } from 'jotai'
import type { TimeRange } from '@/lib/mock-readings'
import type { Dataset, FillStrategyConfig } from '@/lib/preprocessing'
import type {
  ConditionalRule,
  CropRange,
  StatisticalRule,
} from '@/lib/precleanse'
import { nanoid } from 'nanoid'

export type FetchPeriod = '1min' | '5min' | '10min' | '1h' | '1d'

export interface CustomInterval {
  value: number
  unit: 'min' | 'hr' | 'day'
}

export const PERIOD_TO_RANGE: Record<FetchPeriod, TimeRange> = {
  '1min': '24h',
  '5min': '24h',
  '10min': '24h',
  '1h': '7d',
  '1d': '1m',
}
import type { SavedDataSource } from '@/lib/mock-data-sources'
import type {
  DataSourceType,
  DataSourceCredentials,
  CustomDateRange,
  FetchState,
  DiscoveredTag,
} from '@/store/data-visualize'
import { METRIC_KEYS, type MetricKey } from '@/lib/model-metrics'

export type { SavedDataSource }

export interface TrainState {
  status: 'idle' | 'training' | 'done' | 'error'
  progress: number
  error?: string
}

export const MP_TOTAL_STEPS = 7

/** How the user chose to supply tags: direct connector, csv upload, or manual text. */
export type TagInputMethod = '' | 'direct' | 'csv' | 'text'
export const mpTagInputMethodAtom = atom<TagInputMethod>('')
/** Raw text from manual tag entry (newline or comma separated). Also holds parsed CSV column headers. */
export const mpManualTagsRawAtom = atom<string>('')
/** Corrections applied in Compare & Map: original input → corrected tag name. */
export const mpEditedTagsAtom = atom<Record<string, string>>({})
/** Original input strings the user deleted from the Compare & Map table. */
export const mpRemovedTagsAtom = atom<string[]>([])
/** True when at least one row in the Compare & Map table is still invalid (red). */
export const mpHasInvalidTagsAtom = atom<boolean>(false)
export const mpInsertedTagsAtom = atom<string[]>([])
/**
 * Per-tag constant value for Manual / CSV-Upload tags (no real historian data).
 * Keyed by the row's current `tagName` (the dataset column key). Injected into
 * the fetched Raw Data by `buildRawDataset` so the column reads as a flat Good
 * series. Real-connected-source tags are never keyed here.
 */
export const mpTagConstantsAtom = atom<Record<string, number>>({})

const EMPTY_DATASET: Dataset = { tags: [], rows: [] }

export const mpDataSourceAtom = atom<DataSourceType>('')
export const mpDataSourceCredentialsAtom = atom<DataSourceCredentials | null>(
  null,
)
export const mpSavedDataSourcesAtom = atom<SavedDataSource[]>([])
export const mpSelectedSavedSourceIdAtom = atom<string>('')
export const mpSelectedSavedSourceIdsAtom = atom<string[]>([])
export const mpTagListAtom = atom<DiscoveredTag[]>([])
export const mpSelectedTagsAtom = atom<string[]>([])
export const mpTimeRangeAtom = atom<FetchPeriod>('1min')
export const mpCustomDateRangeAtom = atom<CustomDateRange | null>(null)
export const mpFetchStateAtom = atom<FetchState>({
  status: 'idle',
  progress: 0,
})
export const mpRawDatasetAtom = atom<Dataset>(EMPTY_DATASET)

// Phase 5.1 — Data Preprocessing (crop + outlier removal). Applied via
// `precleanse()` before the Phase 5.2 fill step. See `lib/precleanse.ts`.
// Sub-step within wizard Phase 5: 1 = Preprocessing, 2 = Imputation.
export const mpProcessingSubStepAtom = atom<1 | 2>(1)
export const mpCropRangeAtom = atom<CropRange>(null)
export const mpConditionalRulesAtom = atom<ConditionalRule[]>([])
export const mpStatisticalRulesAtom = atom<StatisticalRule[]>([])

// Phase 5.2 — per-tag fill/imputation strategies (consumed by `preprocess()`).
export const mpFillStrategiesAtom = atom<Record<string, FillStrategyConfig>>({})

// Phase 1 — model metadata (drives self-contained step-1 gating in the nav hook).
export const mpNameAtom = atom<string>('')
export const mpDescriptionAtom = atom<string>('')
export const mpWorkspaceIdAtom = atom<string>('')
export const mpPlantIdAtom = atom<string>('')
export const mpNodeIdAtom = atom<string>('')

// Phase 5/6 — training + results.
export const mpTrainStateAtom = atom<TrainState>({
  status: 'idle',
  progress: 0,
})
/** Set once on first successful create; guards against duplicate POSTs on Retrain. */
export const mpCreatedModelIdAtom = atom<string>('')
export const mpSelectedMetricsAtom = atom<MetricKey[]>([...METRIC_KEYS])

export const mpCurrentStepAtom = atom<number>(1)
export const mpHighestUnlockedAtom = atom<number>(1)
export const mpCustomIntervalAtom = atom<CustomInterval | null>(null)

// Tags parsed from CSV upload in Step 2 (first-row column headers)
export const mpCsvUploadTagsAtom = atom<string[]>([])

// Per-tag display metadata for the Step 3 unified table
export interface TagMeta {
  source: string
  status: 'good' | 'error'
  errorReason?: string
}
export const mpTagMetaAtom = atom<Record<string, TagMeta>>({})

// Wizard mode — 'create' starts fresh, 'edit' hydrates from an existing model
// and commits via updateModel instead of createModel.
export type WizardMode = 'create' | 'edit'
export const mpModeAtom = atom<WizardMode>('create')
/** Model id being edited (mode === 'edit'); commits route to updateModel. */
export const mpEditModelIdAtom = atom<string>('')

/**
 * Full wizard reset — clears every `mp*` atom to its initial value. Use when
 * entering a fresh create session so no state leaks from a prior create/edit.
 */
export const resetWizardAtom = atom(null, (_get, set) => {
  set(mpTagInputMethodAtom, 'direct')
  set(mpCsvUploadTagsAtom, [])
  set(mpTagMetaAtom, {})
  set(mpManualTagsRawAtom, '')
  set(mpEditedTagsAtom, {})
  set(mpRemovedTagsAtom, [])
  set(mpHasInvalidTagsAtom, false)
  set(mpTagConstantsAtom, {})
  set(mpDataSourceAtom, '')
  set(mpDataSourceCredentialsAtom, null)
  set(mpSavedDataSourcesAtom, [])
  set(mpSelectedSavedSourceIdAtom, '')
  set(mpSelectedSavedSourceIdsAtom, [])
  set(mpTagListAtom, [])
  set(mpSelectedTagsAtom, [])
  set(mpTimeRangeAtom, '1min')
  set(mpCustomDateRangeAtom, null)
  set(mpFetchStateAtom, { status: 'idle', progress: 0 })
  set(mpRawDatasetAtom, EMPTY_DATASET)
  set(mpProcessingSubStepAtom, 1)
  set(mpCropRangeAtom, null)
  set(mpConditionalRulesAtom, [])
  set(mpStatisticalRulesAtom, [])
  set(mpFillStrategiesAtom, {})
  set(mpNameAtom, '')
  set(mpDescriptionAtom, '')
  set(mpWorkspaceIdAtom, '')
  set(mpPlantIdAtom, '')
  set(mpNodeIdAtom, '')
  set(mpTrainStateAtom, { status: 'idle', progress: 0 })
  set(mpCreatedModelIdAtom, '')
  set(mpSelectedMetricsAtom, [...METRIC_KEYS])
  set(mpModeAtom, 'create')
  set(mpEditModelIdAtom, '')
  set(mpCurrentStepAtom, 1)
  set(mpHighestUnlockedAtom, 1)
  set(mpCustomIntervalAtom, null)
  set(mpFetchTagsAtom, null)
  set(mpSourceFetchConfigsAtom, {})
})

export type SourceType = 'pi' | 'influxdb' | 'sql' | 'rest_api' | 'csv'

export interface PIConfig {
  type: 'pi'
  endpoint: string
  piServerUrl: string
  calcType: 'Average' | 'Interpolated' | 'Recorded'
  calcBasis: 'TimeWeighted' | 'EventWeighted'
  intervalTime: string
}

export interface InfluxConfig {
  type: 'influxdb'
  url: string
  bucket: string
  org: string
  token: string
}

export interface SQLConfig {
  type: 'sql'
  connectionString: string
  query: string
}

export interface RestApiConfig {
  type: 'rest_api'
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  // timestamp field mapping
  timestampField: string
  valueFields: string[]
}

export interface CSVConfig {
  type: 'csv'
  fileName: string
  columns: string[]
  rows: Record<string, string>[]
}

export type DataSourceConfig =
  | PIConfig
  | InfluxConfig
  | SQLConfig
  | RestApiConfig
  | CSVConfig

// null = fetch all good tags from Step 3; explicit array = user-chosen subset
export const mpFetchTagsAtom = atom<string[] | null>(null)
// Per-source fetch configs for Step 4 (keyed by SavedDataSource.id)
export const mpSourceFetchConfigsAtom = atom<Record<string, DataSourceConfig>>(
  {},
)

export interface DataSourceSlot {
  id: string
  label: string
  config: DataSourceConfig
  availableTags: string[]
  selectedTags: string[]
  status: 'idle' | 'browsing' | 'ready' | 'error'
  errorMessage?: string
}

export const qualifyTag = (slotId: string, tag: string) => `${slotId}::${tag}`
export const parseQualifiedTag = (qualified: string) => {
  const idx = qualified.indexOf('::')
  return {
    slotId: qualified.slice(0, idx),
    tag: qualified.slice(idx + 2),
  }
}

export const DEFAULT_PI_CONFIG: PIConfig = {
  type: 'pi',
  endpoint: '',
  piServerUrl: '',
  calcType: 'Average',
  calcBasis: 'TimeWeighted',
  intervalTime: '1m',
}

export const DEFAULT_SQL_CONFIG: SQLConfig = {
  type: 'sql',
  connectionString: '',
  query: '',
}

export const DEFAULT_REST_API_CONFIG: RestApiConfig = {
  type: 'rest_api',
  url: '',
  method: 'GET',
  headers: {},
  timestampField: 'timestamp',
  valueFields: [],
}

export const DEFAULT_CSV_CONFIG: CSVConfig = {
  type: 'csv',
  fileName: '',
  columns: [],
  rows: [],
}

export const createSlot = (type: SourceType, index: number): DataSourceSlot => {
  const label = `Source ${String.fromCharCode(65 + index)}`
  const configMap: Record<SourceType, DataSourceConfig> = {
    pi: { ...DEFAULT_PI_CONFIG },
    influxdb: { type: 'influxdb', url: '', bucket: '', org: '', token: '' },
    sql: { ...DEFAULT_SQL_CONFIG },
    rest_api: { ...DEFAULT_REST_API_CONFIG },
    csv: { ...DEFAULT_CSV_CONFIG },
  }
  return {
    id: nanoid(8),
    label,
    config: configMap[type],
    availableTags: [],
    selectedTags: [],
    status: 'idle',
  }
}

export const mpDataSourcesAtom = atom<DataSourceSlot[]>([createSlot('pi', 0)])

export const mpAllSelectedTagsAtom = atom<string[]>(get =>
  get(mpDataSourcesAtom).flatMap(s => s.selectedTags),
)

export const syncSelectedTagsAtom = atom(
  get => get(mpAllSelectedTagsAtom),
  (_get, set, tags: string[]) => {
    set(mpSelectedTagsAtom, tags)
  },
)

export const MAX_DATA_SOURCES = 3
