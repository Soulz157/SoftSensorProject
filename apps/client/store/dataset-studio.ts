import { atom } from 'jotai'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import type { Dataset, ScalerMethod, TagPipeline } from '@/lib/preprocessing'
import type { FeatureConfig } from '@/lib/feature-engineering'
import type {
  ConditionalRule,
  CropRange,
  StatisticalRule,
  ValueCrop,
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
export const dwValueCropAtom = atom<ValueCrop>({})
export const dwConditionalRulesAtom = atom<ConditionalRule[]>([])
export const dwStatisticalRulesAtom = atom<StatisticalRule[]>([])

// Step 3.2 — Data Cleaning (bulk multi-step pipeline)
// Per-tag ordered cleaning pipeline (missing → outliers → smoothing steps).
export const dwCleaningPipelinesAtom = atom<Record<string, TagPipeline>>({})
// Tags the shared cleaning pipeline is currently applied to (Step 3.2 scope).
export const dwCleaningTagsAtom = atom<string[]>([])

// Step 4 — Feature Engineering
// Selected columns to keep (original + engineered); null = keep all.
export const dwSelectedColumnsAtom = atom<string[] | null>(null)
// Per-column model-ready scaler; missing key defaults to min-max.
export const dwScalerConfigsAtom = atom<Record<string, ScalerMethod>>({})

// Step 3 — Processing sub-step (3.1 preprocessing / 3.2 imputation)
export const dwProcessingSubStepAtom = atom<1 | 2>(1)

// Shared analysis tag-selection (persistent Tag Sidebar ↔ Data Analysis card).
// Visibility only — NEVER the dataset-membership set (dwSelectedTagsAtom).
// `dwHiddenTagsAtom` = tags hidden from charts; activeTags = dataset.tags − hidden.
// `dwFocusedTagAtom` = the emphasized tag driven by a sidebar row click.
export const dwHiddenTagsAtom = atom<string[]>([])
export const dwFocusedTagAtom = atom<string>('')

// Collapse state for the persistent Dataset Tags sidebar in the wizard.
// Read by both the sidebar and the wizard content so collapse persists across steps.
export const dwTagSidebarCollapsedAtom = atom<boolean>(false)

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
    set(dwValueCropAtom, {})
    set(dwConditionalRulesAtom, [])
    set(dwStatisticalRulesAtom, [])
    set(dwCleaningPipelinesAtom, {})
    set(dwCleaningTagsAtom, [])
    set(dwSelectedColumnsAtom, null)
    set(dwScalerConfigsAtom, {})
    set(dwProcessingSubStepAtom, 1)
    set(dwHiddenTagsAtom, [])
    set(dwFocusedTagAtom, '')
    set(dwTagSidebarCollapsedAtom, false)
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
  set(dwCleaningPipelinesAtom, {})
  set(dwCleaningTagsAtom, [])
  set(dwSelectedColumnsAtom, null)
  set(dwScalerConfigsAtom, {})
  set(dwProcessingSubStepAtom, 1)
  set(dwHiddenTagsAtom, [])
  set(dwFocusedTagAtom, '')
  set(dwTagSidebarCollapsedAtom, false)
  set(dwCurrentStepAtom, 1)
  set(dwHighestUnlockedAtom, 1)
})
