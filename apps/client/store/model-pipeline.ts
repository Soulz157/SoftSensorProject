import { atom } from 'jotai'
import type { TimeRange } from '@/lib/mock-readings'
import type { Dataset, FillStrategyConfig } from '@/lib/preprocessing'

export type FetchPeriod = '1min' | '5min' | '10min' | '1h' | '1d'

export const PERIOD_TO_RANGE: Record<FetchPeriod, TimeRange> = {
  '1min': '24h',
  '5min': '24h',
  '10min': '24h',
  '1h': '7d',
  '1d': '1m',
}
import {
  MOCK_DATA_SOURCES,
  type SavedDataSource,
} from '@/lib/mock-data-sources'
import type {
  DataSourceType,
  DataSourceCredentials,
  CustomDateRange,
  FetchState,
  DiscoveredTag,
} from '@/store/data-visualize'
import { METRIC_KEYS, type MetricKey } from '@/lib/model-metrics'

export type { SavedDataSource }

/** Phase-5 training lifecycle (mock — no backend training endpoint yet). */
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

const EMPTY_DATASET: Dataset = { tags: [], rows: [] }

export const mpDataSourceAtom = atom<DataSourceType>('')
export const mpDataSourceCredentialsAtom = atom<DataSourceCredentials | null>(
  null,
)
export const mpSavedDataSourcesAtom = atom<SavedDataSource[]>(MOCK_DATA_SOURCES)
export const mpSelectedSavedSourceIdAtom = atom<string>('')
export const mpTagListAtom = atom<DiscoveredTag[]>([])
export const mpSelectedTagsAtom = atom<string[]>([])
export const mpTimeRangeAtom = atom<FetchPeriod>('1min')
export const mpCustomDateRangeAtom = atom<CustomDateRange | null>(null)
export const mpFetchStateAtom = atom<FetchState>({
  status: 'idle',
  progress: 0,
})
export const mpRawDatasetAtom = atom<Dataset>(EMPTY_DATASET)
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
  set(mpTagInputMethodAtom, '')
  set(mpManualTagsRawAtom, '')
  set(mpEditedTagsAtom, {})
  set(mpRemovedTagsAtom, [])
  set(mpHasInvalidTagsAtom, false)
  set(mpDataSourceAtom, '')
  set(mpDataSourceCredentialsAtom, null)
  set(mpSavedDataSourcesAtom, MOCK_DATA_SOURCES)
  set(mpSelectedSavedSourceIdAtom, '')
  set(mpTagListAtom, [])
  set(mpSelectedTagsAtom, [])
  set(mpTimeRangeAtom, '1min')
  set(mpCustomDateRangeAtom, null)
  set(mpFetchStateAtom, { status: 'idle', progress: 0 })
  set(mpRawDatasetAtom, EMPTY_DATASET)
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
})
