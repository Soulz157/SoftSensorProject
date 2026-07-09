import { atom } from 'jotai'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import type { Dataset, FillStrategyConfig } from '@/lib/preprocessing'
import type { FeatureConfig } from '@/lib/feature-engineering'
import type {
  ConditionalRule,
  CropRange,
  StatisticalRule,
} from '@/lib/precleanse'
import type {
  FetchPeriod,
  CustomInterval,
  DataSourceConfig,
} from '@/store/model-pipeline'
import type { CustomDateRange, FetchState } from '@/store/data-visualize'

export const DW_TOTAL_STEPS = 5

const EMPTY_DATASET: Dataset = { tags: [], rows: [] }

export const dwNameAtom = atom<string>('')
export const dwDescriptionAtom = atom<string>('')
export const dwWorkspaceIdAtom = atom<string>('')
export const dwSelectedSourcesAtom = atom<SavedDataSource[]>([])

// Step 1 — Tags
export const dwSelectedTagsAtom = atom<string[]>([])
export const dwRemovedTagsAtom = atom<string[]>([])
export const dwEditedTagsAtom = atom<Record<string, string>>({})
export const dwHasInvalidTagsAtom = atom<boolean>(false)
export const dwInsertedTagsAtom = atom<string[]>([])
export const dwCsvUploadTagsAtom = atom<string[]>([])
export const dwTagConstantsAtom = atom<Record<string, number>>({})

export const dwFetchTagsAtom = atom<string[] | null>(null)
export const dwTimeRangeAtom = atom<FetchPeriod>('1min')
export const dwCustomDateRangeAtom = atom<CustomDateRange | null>(null)
export const dwCustomIntervalAtom = atom<CustomInterval | null>(null)
export const dwSourceFetchConfigsAtom = atom<Record<string, DataSourceConfig>>(
  {},
)
export const dwFetchStateAtom = atom<FetchState>({
  status: 'idle',
  progress: 0,
})
export const dwRawDatasetAtom = atom<Dataset>(EMPTY_DATASET)

export const dwFeatureConfigsAtom = atom<FeatureConfig[]>([])
export const dwCropRangeAtom = atom<CropRange>(null)
export const dwConditionalRulesAtom = atom<ConditionalRule[]>([])
export const dwStatisticalRulesAtom = atom<StatisticalRule[]>([])

// Step 4 — Fill Null (imputation)
export const dwFillStrategiesAtom = atom<Record<string, FillStrategyConfig>>({})

// Step 3 — Processing sub-step (3.1 preprocessing / 3.2 imputation)
export const dwProcessingSubStepAtom = atom<1 | 2>(1)

// Wizard nav
export const dwCurrentStepAtom = atom<number>(1)
export const dwHighestUnlockedAtom = atom<number>(1)

export interface InitDatasetWizardSeed {
  name: string
  description: string
  workspaceId: string
  sources: SavedDataSource[]
}

/**
 * Single entry point for entering the wizard: resets every `dw*` atom to its
 * initial value and seeds name/description/sources in the same pass, so no
 * state leaks from a prior wizard run and there's no reset-then-seed race.
 */
export const initDatasetWizardAtom = atom(
  null,
  (_get, set, seed: InitDatasetWizardSeed) => {
    set(dwNameAtom, seed.name)
    set(dwDescriptionAtom, seed.description)
    set(dwWorkspaceIdAtom, seed.workspaceId)
    set(dwSelectedSourcesAtom, seed.sources)
    set(dwSelectedTagsAtom, [])
    set(dwRemovedTagsAtom, [])
    set(dwEditedTagsAtom, {})
    set(dwHasInvalidTagsAtom, false)
    set(dwInsertedTagsAtom, [])
    set(dwCsvUploadTagsAtom, [])
    set(dwTagConstantsAtom, {})
    set(dwFetchTagsAtom, null)
    set(dwTimeRangeAtom, '1min')
    set(dwCustomDateRangeAtom, null)
    set(dwCustomIntervalAtom, null)
    set(dwSourceFetchConfigsAtom, {})
    set(dwFetchStateAtom, { status: 'idle', progress: 0 })
    set(dwRawDatasetAtom, EMPTY_DATASET)
    set(dwFeatureConfigsAtom, [])
    set(dwCropRangeAtom, null)
    set(dwConditionalRulesAtom, [])
    set(dwStatisticalRulesAtom, [])
    set(dwFillStrategiesAtom, {})
    set(dwProcessingSubStepAtom, 1)
    set(dwCurrentStepAtom, 1)
    set(dwHighestUnlockedAtom, 1)
  },
)

/** Full wizard reset with no reseed — used after a successful Save. */
export const resetDatasetWizardAtom = atom(null, (_get, set) => {
  set(dwNameAtom, '')
  set(dwDescriptionAtom, '')
  set(dwWorkspaceIdAtom, '')
  set(dwSelectedSourcesAtom, [])
  set(dwSelectedTagsAtom, [])
  set(dwRemovedTagsAtom, [])
  set(dwEditedTagsAtom, {})
  set(dwHasInvalidTagsAtom, false)
  set(dwInsertedTagsAtom, [])
  set(dwCsvUploadTagsAtom, [])
  set(dwTagConstantsAtom, {})
  set(dwFetchTagsAtom, null)
  set(dwTimeRangeAtom, '1min')
  set(dwCustomDateRangeAtom, null)
  set(dwCustomIntervalAtom, null)
  set(dwSourceFetchConfigsAtom, {})
  set(dwFetchStateAtom, { status: 'idle', progress: 0 })
  set(dwRawDatasetAtom, EMPTY_DATASET)
  set(dwFeatureConfigsAtom, [])
  set(dwCropRangeAtom, null)
  set(dwConditionalRulesAtom, [])
  set(dwStatisticalRulesAtom, [])
  set(dwFillStrategiesAtom, {})
  set(dwProcessingSubStepAtom, 1)
  set(dwCurrentStepAtom, 1)
  set(dwHighestUnlockedAtom, 1)
})
