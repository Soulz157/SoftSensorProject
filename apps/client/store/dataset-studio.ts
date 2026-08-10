import { atom } from 'jotai'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import {
  type Dataset,
  type ScalerMethod,
  type TagPipeline,
} from '@/lib/preprocessing'
import { applyFeatures, type FeatureConfig } from '@/lib/feature-engineering'
import { EMPTY_PIPELINE_CONFIG } from '@/lib/pipeline-config'
import type { SavedDataset } from '@/store/datasets'
import type {
  ConditionalRule,
  CropRange,
  RangeExclusion,
  StatisticalRule,
  ValueClip,
  ValueCrop,
} from '@/lib/precleanse'
import type {
  FetchPeriod,
  CustomInterval,
  DataSourceConfig,
} from '@/store/model-pipeline'
import type { CustomDateRange, FetchState } from '@/store/data-visualize'
import {
  DEFAULT_FETCH_CONFIG,
  type HistoricalFetchConfig,
} from '@/lib/fetch-config'
import type { PresetSummary, SdtaConfig } from '@/lib/feature-preset'

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
/**
 * Full dataset parsed from the Step-1 CSV upload. A CSV file already IS the
 * readings, so this stands in for a fetch response: Step 2 narrows it to the
 * selected tags and writes `dwRawDatasetAtom` instead of calling the API.
 * Empty until a file is uploaded.
 */
export const dwCsvDatasetAtom = atom<Dataset>(EMPTY_DATASET)
/** Name of the uploaded CSV — display only (the "CSV Dataset Ready" card). */
export const dwCsvFileNameAtom = atom<string>('')
export const dwTagConstantsAtom = atom<Record<string, number>>({})

export const dwFetchTagsAtom = atom<string[] | null>(null)
export const dwTimeRangeAtom = atom<FetchPeriod>('1min')
export const dwCustomDateRangeAtom = atom<CustomDateRange | null>(null)
export const dwCustomIntervalAtom = atom<CustomInterval | null>(null)
export const dwSourceFetchConfigsAtom = atom<Record<string, DataSourceConfig>>(
  {},
)
// Step 2 — PI historical-fetch summary params (cal basis / aggregate / bucket /
// batch). Distinct from per-source connection config above. See lib/fetch-config.
export const dwFetchConfigAtom = atom<HistoricalFetchConfig>({
  ...DEFAULT_FETCH_CONFIG,
})
export const dwFetchStateAtom = atom<FetchState>({
  status: 'idle',
  progress: 0,
})

/**
 * Whether Step 2 must run a live fetch before the wizard can advance.
 *
 * CSV sources carry their readings in the uploaded file, so they need no fetch;
 * PI / SQL / REST do. An empty selection reads as "not required" — the
 * source-less CSV Upload path also skips fetching, and an empty dataset still
 * fails the `rows.length > 0` half of the Step-2 gate, so nothing unlocks early.
 */
export const dwFetchRequiredAtom = atom<boolean>(get =>
  get(dwSelectedSourcesAtom).some(s => s.type !== 'csv'),
)
export const dwRawDatasetAtom = atom<Dataset>(EMPTY_DATASET)

/**
 * Rich per-batch progress for the client-orchestrated historical fetch (P6).
 * Kept SEPARATE from `dwFetchStateAtom` (which stays the {status,progress,error}
 * source driving the step chain + auto-advance) so the extra detail never
 * changes the shared `FetchState` shape. `failedBatches` holds the tag lists of
 * batches that errored, so "Retry N failed batches" can re-run only those.
 */
export interface FetchProgress {
  totalBatches: number
  completedBatches: number
  currentBatchTags: string[]
  totalTags: number
  completedTags: number
  etaMs: number | null
  failedBatches: string[][]
}

export const EMPTY_FETCH_PROGRESS: FetchProgress = {
  totalBatches: 0,
  completedBatches: 0,
  currentBatchTags: [],
  totalTags: 0,
  completedTags: 0,
  etaMs: null,
  failedBatches: [],
}

export const dwFetchProgressAtom = atom<FetchProgress>({
  ...EMPTY_FETCH_PROGRESS,
})

export const dwFeatureConfigsAtom = atom<FeatureConfig[]>([])

// Feature Preset — provenance of an applied soft-sensor template (F6/F7).
// Equations it queued live in dwFeatureConfigsAtom like any other feature; this
// is display-only ("Applied from preset: …" in Step 4/5) plus the persisted
// pointer that lets edit mode know a saved dataset came from one.
export const dwFeaturePresetAtom = atom<PresetSummary | null>(null)
// The preset's target (Y). Deliberately separate from dwSelectedTagsAtom: every
// workbook Y is a `.lab` tag absent from a PI-only catalogue, so gating Apply on
// it would block every preset — see canApply() in lib/feature-preset.ts. Its
// absence is instead surfaced as a loud, non-blocking warning at Step 5.
export const dwTargetTagAtom = atom<string | null>(null)
// SD&TA (shutdown/turnaround) cut config from the same workbook, if it had one.
// Parsed and available for the opt-in "Apply SD/TA cut config" card; consuming
// it into dwExclusionsAtom / dwConditionalRulesAtom is FP-8. Not persisted in
// pipelineConfig — it is import-time state, not part of the saved recipe.
export const dwSdtaConfigAtom = atom<SdtaConfig | null>(null)

// Raw dataset + engineered feature columns, recomputed live from the recipe.
// Read-only derived — never writes back to dwRawDatasetAtom (fetch seam).
// `applyFeatures` returns the raw dataset unchanged when there are no configs.
export const dwFeaturedDatasetAtom = atom<Dataset>(get =>
  applyFeatures(get(dwRawDatasetAtom), get(dwFeatureConfigsAtom)),
)
export const dwCropRangeAtom = atom<CropRange>(null)
export const dwValueCropAtom = atom<ValueCrop>({})
export const dwValueClipAtom = atom<ValueClip>({})
// Dragged exclusion bands (Drag-to-Crop "Exclude" mode) — remove-inside spans.
export const dwExclusionsAtom = atom<RangeExclusion[]>([])
export const dwConditionalRulesAtom = atom<ConditionalRule[]>([])
export const dwStatisticalRulesAtom = atom<StatisticalRule[]>([])

// Step 3.2 — Data Cleaning (bulk multi-step pipeline)
// Per-tag ordered cleaning pipeline (missing → outliers → smoothing steps).
export const dwCleaningPipelinesAtom = atom<Record<string, TagPipeline>>({})
// Tags the shared cleaning pipeline is currently applied to (Step 3.2 scope).
export const dwCleaningTagsAtom = atom<string[]>([])
// Tags whose cleaning pipeline has been explicitly SAVED (the "Cleaned" status
// set). Distinct from a tag merely having steps — Save is the commit point that
// moves a batch from Pending → Cleaned. Sidebar renders the green check off this.
export const dwCleanedTagsAtom = atom<string[]>([])
export const dwSelectedTagKeysAtom = atom<Set<string>>(new Set<string>())

// Step 4 — Feature Engineering
// Selected columns to keep (original + engineered); null = keep all.
export const dwSelectedColumnsAtom = atom<string[] | null>(null)
// Per-column model-ready scaler; missing key defaults to min-max.
export const dwScalerConfigsAtom = atom<Record<string, ScalerMethod>>({})

// Step 3 — Processing sub-step (3.1 preprocessing / 3.2 imputation)
export const dwProcessingSubStepAtom = atom<1 | 2>(1)

// Draft-first architecture (DS-LAKE-005/DS-LAKE-004B) — the wizard's
// server-side owner while no Dataset row exists yet. `dwDraftArtifactIdAtom`
// is the BRONZE (or latest SILVER) artifact a clean job reads from; both stay
// null until the first "Save Cleaned Tags" triggers the server sync.
export const dwDraftIdAtom = atom<string | null>(null)
export const dwDraftArtifactIdAtom = atom<string | null>(null)
export interface DraftSyncState {
  status: 'idle' | 'syncing' | 'synced' | 'error'
  error?: string
}
export const dwDraftSyncStateAtom = atom<DraftSyncState>({ status: 'idle' })

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

// Wizard mode — 'create' builds a new dataset; 'edit' re-opens a saved recipe
// to change ONLY the preprocessing pipeline (raw query stays locked).
export type DwWizardMode = 'create' | 'edit'
export const dwModeAtom = atom<DwWizardMode>('create')
/** Dataset id being edited (mode === 'edit'); Save routes to update, not create. */
export const dwEditingDatasetIdAtom = atom<string>('')

/**
 * The saved dataset being edited, in full.
 *
 * The id alone is not enough: hydrating real rows needs `currentVersionId` and
 * `pipelineConfig` to choose between reading the committed artifact,
 * materialising one, and falling back to synthetic rows.
 */
export const dwEditingDatasetAtom = atom<SavedDataset | null>(null)

/**
 * Where the rows in `dwRawDatasetAtom` actually came from.
 *
 * `'synthetic'` means GENERATED, not read from the source. The UI is required
 * to say so: invented numbers look entirely plausible in a table, and that
 * indistinguishability is the failure mode this slice exists to remove.
 */
export const dwRowSourceAtom = atom<'stored' | 'synthetic' | null>(null)

/** Why synthetic rows were used, for the banner. Null unless synthetic. */
export const dwSyntheticReasonAtom = atom<string | null>(null)

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
    set(dwCsvDatasetAtom, EMPTY_DATASET)
    set(dwCsvFileNameAtom, '')
    set(dwTagConstantsAtom, {})
    set(dwFetchTagsAtom, null)
    set(dwTimeRangeAtom, '1min')
    set(dwCustomDateRangeAtom, null)
    set(dwCustomIntervalAtom, null)
    set(dwSourceFetchConfigsAtom, {})
    set(dwFetchConfigAtom, { ...DEFAULT_FETCH_CONFIG })
    set(dwFetchStateAtom, { status: 'idle', progress: 0 })
    set(dwFetchProgressAtom, { ...EMPTY_FETCH_PROGRESS })
    set(dwRawDatasetAtom, EMPTY_DATASET)
    set(dwFeatureConfigsAtom, [])
    set(dwFeaturePresetAtom, null)
    set(dwTargetTagAtom, null)
    set(dwSdtaConfigAtom, null)
    set(dwCropRangeAtom, null)
    set(dwExclusionsAtom, [])
    set(dwValueCropAtom, {})
    set(dwConditionalRulesAtom, [])
    set(dwStatisticalRulesAtom, [])
    set(dwCleaningPipelinesAtom, {})
    set(dwCleaningTagsAtom, [])
    set(dwCleanedTagsAtom, [])
    set(dwSelectedColumnsAtom, null)
    set(dwScalerConfigsAtom, {})
    set(dwProcessingSubStepAtom, 1)
    set(dwHiddenTagsAtom, [])
    set(dwFocusedTagAtom, '')
    set(dwTagSidebarCollapsedAtom, false)
    set(dwCurrentStepAtom, 1)
    set(dwHighestUnlockedAtom, 1)
    set(dwModeAtom, 'create')
    set(dwEditingDatasetIdAtom, '')
    // Row provenance is per-wizard-run. Left behind, a previous EDIT session's
    // 'synthetic' verdict makes the banner accuse a fresh create — whose rows
    // come from a live fetch — of showing invented numbers.
    set(dwEditingDatasetAtom, null)
    set(dwRowSourceAtom, null)
    set(dwSyntheticReasonAtom, null)
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
  set(dwCsvDatasetAtom, EMPTY_DATASET)
  set(dwCsvFileNameAtom, '')
  set(dwTagConstantsAtom, {})
  set(dwFetchTagsAtom, null)
  set(dwTimeRangeAtom, '1min')
  set(dwCustomDateRangeAtom, null)
  set(dwCustomIntervalAtom, null)
  set(dwSourceFetchConfigsAtom, {})
  set(dwFetchConfigAtom, { ...DEFAULT_FETCH_CONFIG })
  set(dwFetchStateAtom, { status: 'idle', progress: 0 })
  set(dwFetchProgressAtom, { ...EMPTY_FETCH_PROGRESS })
  set(dwRawDatasetAtom, EMPTY_DATASET)
  set(dwFeatureConfigsAtom, [])
  set(dwFeaturePresetAtom, null)
  set(dwTargetTagAtom, null)
  set(dwSdtaConfigAtom, null)
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
  set(dwModeAtom, 'create')
  set(dwEditingDatasetIdAtom, '')
  // Same reason as initDatasetWizardAtom: this runs right after Save, and the
  // next wizard run must not inherit this one's provenance verdict.
  set(dwEditingDatasetAtom, null)
  set(dwRowSourceAtom, null)
  set(dwSyntheticReasonAtom, null)
})

/**
 * Enter the wizard in EDIT mode: hydrate every `dw*` atom from a saved dataset's
 * recipe, rebuild the raw dataset deterministically (so charts/preview render
 * without a fetch), and land on Step 3 (Data Processing) with all steps
 * unlocked. Steps 1/2/4 are rendered read-only by the wizard — only the
 * preprocessing pipeline may change, so downstream model schemas stay intact.
 *
 * Base tags fall back to the dataset's final `tags` for legacy recipes saved
 * before `pipelineConfig.baseTags` existed (imperfect but non-crashing).
 */
export interface InitDatasetWizardEditSeed {
  dataset: SavedDataset
  sources: SavedDataSource[]
}

export const initDatasetWizardForEditAtom = atom(
  null,
  (_get, set, seed: InitDatasetWizardEditSeed) => {
    const { dataset, sources } = seed
    // Coalesce every field against EMPTY_PIPELINE_CONFIG — recipes saved before
    // a given field existed store it as `undefined`, and the pipeline helpers
    // index these maps by tag (`pipelines[tag]`), which throws on undefined.
    const config = { ...EMPTY_PIPELINE_CONFIG, ...dataset.pipelineConfig }
    const baseTags = config.baseTags ?? dataset.tags
    const tagConstants = config.tagConstants ?? {}

    set(dwModeAtom, 'edit')
    set(dwEditingDatasetIdAtom, dataset.id)

    set(dwNameAtom, dataset.name)
    set(dwDescriptionAtom, dataset.description ?? '')
    set(dwWorkspaceIdAtom, dataset.workspaceId)
    set(dwSelectedSourcesAtom, sources)

    // Step 1 — Tags (locked in edit mode, but hydrated for display).
    set(dwSelectedTagsAtom, baseTags)
    set(dwRemovedTagsAtom, [])
    set(dwEditedTagsAtom, {})
    set(dwHasInvalidTagsAtom, false)
    set(dwInsertedTagsAtom, [])
    set(dwCsvUploadTagsAtom, [])
    // Edit mode rebuilds the raw grid from the saved recipe, never from a file.
    set(dwCsvDatasetAtom, EMPTY_DATASET)
    set(dwCsvFileNameAtom, '')
    set(dwTagConstantsAtom, tagConstants)

    // Step 2 — Fetch (locked). Rebuild the raw dataset in place of a live fetch.
    set(dwFetchTagsAtom, baseTags)
    set(dwTimeRangeAtom, config.timeRange)
    set(dwCustomDateRangeAtom, config.customDateRange)
    set(dwCustomIntervalAtom, config.customInterval)
    set(dwSourceFetchConfigsAtom, config.sourceFetchConfigs)
    // Fetch is locked in edit mode (raw query is rebuilt deterministically, not
    // re-fetched), so summary params are not persisted in the recipe — reset to
    // defaults rather than reading a field that older recipes never stored.
    set(dwFetchConfigAtom, { ...DEFAULT_FETCH_CONFIG })
    // Rows are NOT seeded here any more. This used to call `buildRawDataset`,
    // which regenerates synthetic readings from a seed — so editing a dataset
    // showed invented numbers that merely resembled the saved one.
    //
    // `useDatasetEditHydration` fills these from the committed artifact (or
    // materialises one), and falls back to synthetic rows only when the recipe
    // cannot be replayed — with a banner saying so. Left `loading` rather than
    // `done` so the wizard shows progress instead of an empty table.
    set(dwRawDatasetAtom, EMPTY_DATASET)
    set(dwFetchStateAtom, { status: 'fetching', progress: 0 })
    set(dwEditingDatasetAtom, dataset)
    set(dwRowSourceAtom, null)
    set(dwSyntheticReasonAtom, null)

    // Step 3 — Preprocessing (EDITABLE surface).
    set(dwCropRangeAtom, config.cropRange)
    // Legacy recipes predate valueCrop being persisted — those hydrate empty.
    set(dwValueCropAtom, config.valueCrop ?? {})
    set(dwExclusionsAtom, config.exclusions ?? [])
    set(dwConditionalRulesAtom, config.conditionalRules)
    set(dwStatisticalRulesAtom, config.statisticalRules)
    set(dwCleaningPipelinesAtom, config.cleaningPipelines)
    // Committed "Cleaned" status reflects the saved per-tag pipelines. The
    // active editing batch (dwCleaningTagsAtom) opens empty so the user starts
    // from a clean selection instead of a merged draft across mixed pipelines.
    set(dwCleaningTagsAtom, [])
    set(dwCleanedTagsAtom, Object.keys(config.cleaningPipelines ?? {}))

    // Step 4 — Feature Engineering (locked, hydrated for display).
    set(dwFeatureConfigsAtom, config.features)
    set(dwSelectedColumnsAtom, config.selectedColumns)
    set(dwScalerConfigsAtom, config.scalers)
    // Preset provenance + target, if this recipe was built from one. Legacy
    // recipes predate both fields and hydrate to null, same as baseTags above.
    set(dwFeaturePresetAtom, config.featurePreset ?? null)
    set(dwTargetTagAtom, config.targetTag ?? null)
    // Not persisted (see the atom's own comment) — nothing to hydrate.
    set(dwSdtaConfigAtom, null)

    set(dwProcessingSubStepAtom, 1)
    set(dwHiddenTagsAtom, [])
    set(dwFocusedTagAtom, '')
    set(dwTagSidebarCollapsedAtom, false)

    // Land on Data Processing with every step unlocked for review.
    set(dwCurrentStepAtom, 3)
    set(dwHighestUnlockedAtom, DW_TOTAL_STEPS)
  },
)
