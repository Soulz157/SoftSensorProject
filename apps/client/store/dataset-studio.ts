import { atom } from 'jotai'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import {
  brandBoundedSample,
  type BoundedSample,
  type Dataset,
  type ScalerMethod,
  type TagPipeline,
} from '@/lib/preprocessing'
import {
  applyFeaturesBounded,
  type FeatureConfig,
} from '@/lib/feature-engineering'
import { EMPTY_PIPELINE_CONFIG } from '@/lib/pipeline-config'
import type { SavedDataset } from '@/store/datasets'
import type { DatasetArtifactStage } from '@/services/dataset-draft'
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
import type {
  ParsedRange,
  PresetDocument,
  PresetSummary,
  SdtaConfig,
} from '@/lib/feature-preset'
import {
  SdtaPreset,
  isEmptySdta,
  upsertSdtaPreset,
} from '@/lib/feature-preset-apply'

// DS-LAKE-022-T04..T07: 5 -> 6. Data Cleaning moves off Step 3 (sub-step 3.2)
// onto its own Step 5, after Feature Engineering (now Step 4); Review & Save
// becomes Step 6. See dwDraftFeatureArtifactIdAtom below for the artifact-id
// plumbing this reorder needs.
export const DW_TOTAL_STEPS = 6

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
/**
 * Per-tag engineering unit, snapshotted from `useDatasetTagMetadata`'s
 * `metaByTag` while Step 1 is mounted (DS-LAKE-020-T03) — that hook's state
 * is hook-local and dies with the component, so a later step (Step 3.2's
 * range-cutoff unit gate) would otherwise see no unit at all. `null` for a
 * tag with no known unit (CSV-uploaded, manually inserted, or not yet
 * resolved) — a real absence, not a loading state.
 */
export const dwTagUnitsAtom = atom<Record<string, string | null>>({})

/**
 * User-entered unit for a tag with no PI-reported unit (CSV/manual, or a PI
 * tag whose metadata omits it) — fills the gap `dwTagUnitsAtom` alone leaves
 * as `null`, so the T03 range-cutoff unit gate isn't permanently refused for
 * those tags. Session-scoped, same lifetime as `dwTagUnitsAtom` itself (not
 * restored on edit hydration — matches that atom's own documented limit).
 */
export const dwTagUnitOverridesAtom = atom<Record<string, string>>({})

/**
 * One proposed range cutoff per `raw_tag` preset feature with a parseable,
 * non-`'none'` range, snapshotted at Apply Preset time (DS-LAKE-020-T05) —
 * `dwFeaturePresetAtom` only keeps the metadata `PresetSummary`, and the full
 * `PresetDocument.features[].range_parsed` is otherwise discarded once the
 * apply-preset modal closes (DS-LAKE-020-T01 finding). Ephemeral proposal
 * scaffolding, not the persisted truth: once a candidate is toggled on, its
 * RESOLVED bound is baked into a `ConditionalRule.presetRange` (T07), which
 * is what actually survives Save / reopen. Ranges on `equation` features are
 * never candidates here — the derived column does not exist until Step 4.
 */
export interface PresetRangeCandidate {
  tag: string
  /** The feature's generated name — may carry a `_2` suffix when the same
   * physical tag appears twice in one config; kept for row provenance. */
  rowLabel: string
  quotedRange: string
  parsed: ParsedRange
  presetId: string
  configNo: number
  /** Process unit / sheet the config came from (`document.unit`). */
  sheet: string
}
/**
 * DS-LAKE-020-T05, extracted. Every "Apply Preset" entry point (Step 1's
 * `unified-tag-table.tsx` in create mode, Step 3.1's edit-mode-only button)
 * needs the same range-candidate mapping — kept in one place so a schema
 * change to `PresetFeature` only needs fixing here, not per caller. Lives
 * beside `PresetRangeCandidate` rather than in `lib/feature-preset.ts`: that
 * module holds pure preset types this file already imports, and this
 * function returns a type (`PresetRangeCandidate`) that lives here instead —
 * putting the function in `feature-preset.ts` would need it importing back
 * from this file, a circular import neither module has today.
 */
export function presetRangeCandidatesFromDocument(
  document: PresetDocument,
): PresetRangeCandidate[] {
  return document.features
    .filter(
      f =>
        f.type === 'raw_tag' &&
        f.range_parsed !== null &&
        f.range_parsed.kind !== 'none',
    )
    .map(f => ({
      tag: f.required_base_tags[0] ?? f.name,
      rowLabel: f.name,
      quotedRange: f.range,
      parsed: f.range_parsed!,
      presetId: document.preset_id,
      configNo: document.config_no,
      sheet: document.unit,
    }))
}

/**
 * DS-LAKE-020-T05 sibling, for the edit-mode-only Apply Preset button
 * (Step 3.1, "Feature apply preset"). Tags are locked once a dataset exists
 * (`step-1-tags.tsx`'s edit-mode lock — changing them would break downstream
 * model schemas), so unlike Step 1's own apply path this never adds a tag:
 * a preset's range candidate for a tag the dataset doesn't already have is
 * dropped, not staged. Pure so the filtering is unit-testable without
 * rendering the step.
 */
export interface LockedPresetRangeResult {
  candidates: PresetRangeCandidate[]
  /** Candidates dropped because their tag isn't in `lockedTags`. */
  skippedCount: number
}

export function lockedPresetRangeCandidates(
  document: PresetDocument,
  lockedTags: ReadonlySet<string> | readonly string[],
): LockedPresetRangeResult {
  const locked = lockedTags instanceof Set ? lockedTags : new Set(lockedTags)
  const all = presetRangeCandidatesFromDocument(document)
  const candidates = all.filter(c => locked.has(c.tag))
  return { candidates, skippedCount: all.length - candidates.length }
}

export const dwPresetRangeAtom = atom<PresetRangeCandidate[]>([])
/**
 * True when the applied preset predates range-cutoff support
 * (`schema_version < 2`, DS-LAKE-020-T02) — the document genuinely has no
 * `range_parsed` on any feature, not merely none worth proposing. Lets Step
 * 3.2 tell "nothing to propose" apart from "re-import to enable this".
 */
export const dwPresetRangeStaleAtom = atom<boolean>(false)

export const dwFetchTagsAtom = atom<string[] | null>(null)
export const dwTimeRangeAtom = atom<FetchPeriod>('1min')
export const dwCustomDateRangeAtom = atom<CustomDateRange | null>(null)
export const dwCustomIntervalAtom = atom<CustomInterval | null>(null)
/**
 * DS-LAKE-018-T01: the raw validation holdout window, selected beside the
 * fetch range above. Null means no holdout — the dataset behaves exactly as
 * today (acceptance criterion). Distinct atom rather than a field on the
 * fetch range itself: the holdout is optional and independently editable,
 * and `describeHoldoutSelection` (lib/holdout.ts) needs both ranges at once
 * to run its guards.
 */
export const dwHoldoutRangeAtom = atom<CustomDateRange | null>(null)
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

// SD&TA (shutdown/turnaround) cut configs from imported workbooks. Staged
// here by the preset manager; nothing is cut until the user selects presets
// and applies in Step 3.2's card. Not persisted in pipelineConfig — the
// resulting exclusions/rules are, this list is import-time state.
export const dwSdtaPresetsAtom = atom<SdtaPreset[]>([])

export type StageSdtaResult = 'staged' | 'replaced' | 'empty'

export const dwStageSdtaPresetAtom = atom(
  null,
  (get, set, preset: SdtaPreset): StageSdtaResult => {
    if (isEmptySdta(preset.config)) return 'empty'
    const current = get(dwSdtaPresetsAtom)
    const existed = current.some(p => p.id === preset.id)
    set(dwSdtaPresetsAtom, upsertSdtaPreset(current, preset))
    return existed ? 'replaced' : 'staged'
  },
)

// DS-LAKE-006-AC5 / DS-LAKE-005B-B-T04: a real bounded page of the draft's
// current source artifact, fetched via the server's bounded /rows endpoint
// (DS-LAKE-005B-A) by `useDatasetFeaturePreviewSample`. NOT a client-side
// slice of dwRawDatasetAtom — see `applyFeaturesBounded`'s doc comment in
// feature-engineering.ts for why that would satisfy the compiler without
// satisfying what `BoundedSample` actually documents. Empty until the hook's
// first fetch resolves.
export const dwFeaturePreviewSampleAtom = atom<BoundedSample>(
  brandBoundedSample({ tags: [], rows: [] }),
)
// DS-LAKE-015-T02: lets a caller tell "in flight" from "resolved empty" from
// "failed" for the fetch above — today it cannot, since the hook swallows
// failures and returns void. The swallow stays the ERROR-HANDLING policy (an
// empty sample is not a broken state, per that hook's own doc comment); this
// only adds the ABILITY to distinguish the three windows. 'ready' covers a
// successfully resolved fetch whether or not `dwFeaturePreviewSampleAtom` ends
// up with rows — Step 3.1 derives "ready but empty" itself by reading both.
export type PreviewSampleFetchState = 'idle' | 'loading' | 'ready' | 'error'
export const dwFeaturePreviewSampleStateAtom =
  atom<PreviewSampleFetchState>('idle')

// Feature-engineered preview for Step 4's own UI (panels, analysis card,
// tag sidebar) — recomputed live from the recipe, but over the BOUNDED
// sample above, not the full raw dataset. Read-only derived. Deliberately
// NOT what Step 5 uses to compute what actually gets saved — that recompute
// is separate and genuinely needs the full dataset (see step-5-review-
// save.tsx), which this atom is not a substitute for.
//
// Typed `BoundedSample`, not `Dataset` (DS-LAKE-005B-D-T07): the value
// really is one now that `applyFeaturesBounded` re-brands its output — this
// atom is `DataAnalysisCard`'s dataset feed at Step 4, and that prop is
// itself `BoundedSample`-typed. `BoundedSample extends Dataset`, so this
// widened type breaks nothing at either of the two existing `.tags`/`.rows`
// readers.
export const dwFeaturedDatasetAtom = atom<BoundedSample>(get =>
  applyFeaturesBounded(
    get(dwFeaturePreviewSampleAtom),
    get(dwFeatureConfigsAtom),
  ),
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

// Draft-first architecture (DS-LAKE-005/DS-LAKE-004B) — the wizard's
// server-side owner while no Dataset row exists yet. `dwDraftArtifactIdAtom`
// is the BRONZE (or latest SILVER) artifact a clean job reads from; both stay
// null until the first "Save Cleaned Tags" triggers the server sync.
export const dwDraftIdAtom = atom<string | null>(null)
export const dwDraftArtifactIdAtom = atom<string | null>(null)
// DS-LAKE-015-T01: PROGRESS for `useDatasetBronzeWarm`'s background
// materialize — separate from `dwDraftSyncStateAtom`, which stays the
// user-facing FAILURE banner and is deliberately never touched by the warm
// (DS-LAKE-005B-B-T01's Q2 decision; see that hook's own doc comment).
// `failed` exists so the state machine stops reading "preparing" forever,
// NOT to drive an error banner — the lazy retry on the user's first real
// Apply (`ensureBronze` in `useDatasetDraftPipeline`) is still the only
// recovery path. Reset to 'idle' alongside the other draft-scoped atoms.
export type BronzeWarmState = 'idle' | 'materializing' | 'ready' | 'failed'
export const dwBronzeWarmStateAtom = atom<BronzeWarmState>('idle')
// DS-LAKE-006-T06. The GOLD artifact Step 4's background warm produces from
// `dwDraftArtifactIdAtom` (normally SILVER) — kept SEPARATE from it on
// purpose: overwriting `dwDraftArtifactIdAtom` with the GOLD result would
// make the NEXT feature-recipe edit compute GOLD-from-GOLD instead of
// GOLD-from-SILVER, silently losing the ability to redo feature engineering
// against the same cleaned base. No current reader — Step 5 Save still uses
// the pre-DS-LAKE-009 raw-refetch/client-pipeline path (ADR-DS-LAKE-005B-B-006
// names DS-LAKE-009 as where Save adopts a completed artifact); this exists
// so Step 4 itself satisfies its own AC ("drives the transform server-side"),
// not because Save reads it yet.
export const dwDraftGoldArtifactIdAtom = atom<string | null>(null)
/**
 * DS-LAKE-022-T04..T07. The features-only SILVER a reordered-order Step 4
 * warm produces (`useDatasetGoldWarm` sending `scale: false`) — CREATE MODE
 * ONLY. Named distinctly from `dwDraftArtifactIdAtom` (which stays the
 * cleaning chain's own source/output in both modes) because the two must
 * never collide: under the reorder, Step 5's clean+scale job reads FROM
 * this atom and writes its GOLD result into `dwDraftGoldArtifactIdAtom`,
 * while `dwDraftArtifactIdAtom` (BRONZE) stays untouched as the fixed
 * source every "Save Cleaned Tags" batch replays against (D4 — cleaning
 * sources the SILVER, it does not chain onto itself).
 *
 * Stays null in EDIT mode on purpose. Editing a saved dataset only allows
 * changing the preprocessing pipeline (features/tags/time-range are
 * locked and hydrated for display only), so edit mode keeps the legacy
 * combined write untouched: Step 4's warm there still writes the final
 * GOLD straight into `dwDraftGoldArtifactIdAtom`, exactly as before this
 * feature. Every reader that falls back through
 * `goldArtifactId ?? featureArtifactId ?? draftArtifactId` therefore still
 * resolves correctly in edit mode — the middle term is just always null.
 */
export const dwDraftFeatureArtifactIdAtom = atom<string | null>(null)
// Surfaces `useDatasetGoldWarm`'s own failures (formula-kind 422s chief among
// them — feature presets emit ONLY `kind: 'formula'`, unimplemented server-
// side). Previously swallowed silently; now read by Step 4 and folded into
// Step 5's `goldNotReady` message so "Waiting for feature engineering to
// finish…" states the real reason instead of nothing. Cleared on a fresh
// warm attempt, on success, and on wizard reset alongside the other two.
export const dwGoldWarmErrorAtom = atom<string | null>(null)

/**
 * DS-LAKE-023 (edit-mode re-split pass). `useDatasetGoldWarm`'s own
 * pending/settled state, published here (not just returned from the hook)
 * so a sibling component — `ValidationHoldoutSection`, mounted alongside
 * the recipe editors rather than inside them — can read it without a prop
 * drilled through `Step4FeatureEngineering`. 'idle' before the first warm;
 * 'pending' while the debounced job is scheduled or in flight; 'ready' on
 * the last SUCCEEDED response; 'error' mirrors `dwGoldWarmErrorAtom` being
 * non-null (kept as a separate atom, not derived, so a consumer that only
 * cares about "is it safe to commit" doesn't have to also branch on the
 * error atom's null-ness).
 */
export type FeatureWarmState = 'idle' | 'pending' | 'ready' | 'error'
export const dwFeatureWarmStateAtom = atom<FeatureWarmState>('idle')

/**
 * DS-LAKE-023. A stable signature of the recipe
 * `{features, selectedColumns, scalers, targetY, holdout}` that the LAST
 * successfully committed feature artifact was actually built from —
 * written by `useDatasetGoldWarm` alongside the artifact id, on the same
 * SUCCEEDED branch. `useDatasetCleaningScaleCommit` compares this against
 * the CURRENT recipe's own signature before committing Step 5's clean+scale
 * job: a mismatch means the artifact in `dwDraftFeatureArtifactIdAtom` (or
 * `dwDraftGoldArtifactIdAtom` in edit mode) describes a recipe the user has
 * since changed — most concretely, a holdout applied and then navigated
 * away from before its warm landed (D4/AC3: `goTo` unlocks Step 5 the
 * instant `highestUnlocked` allows it, with no wait on this hook's own
 * pending state). Comparing the FULL recipe, not just the holdout, is
 * deliberate — see this atom's own consumer for why trimming it to
 * `holdout` alone would silently under-gate create mode.
 */
export const dwFeatureArtifactStampAtom = atom<string | null>(null)

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

/**
 * Pipeline stage of the artifact `dwRawDatasetAtom` was hydrated from — the
 * edit-mode twin of `VersionRowsState.stage`
 * (`hooks/dataset/use-dataset-version-rows.ts`), written by
 * `useDatasetEditHydration`. Null while `dwRowSourceAtom !== 'stored'` or
 * before hydration resolves. `wizard-shell.tsx` reads this to warn when the
 * hydrated rows are already past BRONZE — Step 3's crop/clean/impute would
 * otherwise double-apply on top of an already-processed artifact.
 */
export const dwRowStageAtom = atom<DatasetArtifactStage | null>(null)

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
    set(dwTagUnitsAtom, {})
    set(dwTagUnitOverridesAtom, {})
    set(dwPresetRangeAtom, [])
    set(dwPresetRangeStaleAtom, false)
    set(dwFetchTagsAtom, null)
    set(dwTimeRangeAtom, '1min')
    set(dwCustomDateRangeAtom, null)
    set(dwHoldoutRangeAtom, null)
    set(dwCustomIntervalAtom, null)
    set(dwSourceFetchConfigsAtom, {})
    set(dwFetchConfigAtom, { ...DEFAULT_FETCH_CONFIG })
    set(dwFetchStateAtom, { status: 'idle', progress: 0 })
    set(dwFetchProgressAtom, { ...EMPTY_FETCH_PROGRESS })
    set(dwRawDatasetAtom, EMPTY_DATASET)
    set(dwFeatureConfigsAtom, [])
    set(dwFeaturePresetAtom, null)
    set(dwTargetTagAtom, null)
    set(dwSdtaPresetsAtom, [])
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
    set(dwValueClipAtom, {})
    set(dwSelectedTagKeysAtom, new Set<string>())
    // Draft-first server state. Mirrors resetDatasetWizardAtom's own fix for
    // "THE GROUP THAT CAUSED THE DRIFT" — a stale dwFeaturePreviewSampleAtom
    // is what the tag sidebar and every chart actually read their tag list
    // from, not dwSelectedTagsAtom above, so leaving it here leaks a prior
    // EDIT session's tags into a fresh create run.
    set(dwDraftIdAtom, null)
    set(dwDraftArtifactIdAtom, null)
    set(dwDraftFeatureArtifactIdAtom, null)
    set(dwDraftGoldArtifactIdAtom, null)
    set(dwBronzeWarmStateAtom, 'idle')
    set(dwGoldWarmErrorAtom, null)
    set(dwFeatureWarmStateAtom, 'idle')
    set(dwFeatureArtifactStampAtom, null)
    set(dwDraftSyncStateAtom, { status: 'idle' })
    set(dwFeaturePreviewSampleAtom, brandBoundedSample({ tags: [], rows: [] }))
    set(dwFeaturePreviewSampleStateAtom, 'idle')
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
    set(dwRowStageAtom, null)
  },
)

/** Full wizard reset with no reseed — used after a successful Save. */
export const resetDatasetWizardAtom = atom(null, (_get, set) => {
  set(dwNameAtom, '')
  set(dwDescriptionAtom, '')
  set(dwWorkspaceIdAtom, '')
  set(dwSelectedSourcesAtom, [])

  // Step 1
  set(dwSelectedTagsAtom, [])
  set(dwRemovedTagsAtom, [])
  set(dwEditedTagsAtom, {})
  set(dwHasInvalidTagsAtom, false)
  set(dwInsertedTagsAtom, [])
  set(dwCsvUploadTagsAtom, [])
  set(dwCsvDatasetAtom, EMPTY_DATASET)
  set(dwCsvFileNameAtom, '')
  set(dwTagConstantsAtom, {})
  set(dwTagUnitsAtom, {})
  set(dwTagUnitOverridesAtom, {})
  set(dwPresetRangeAtom, [])
  set(dwPresetRangeStaleAtom, false)

  // Step 2
  set(dwFetchTagsAtom, null)
  set(dwTimeRangeAtom, '1min')
  set(dwCustomDateRangeAtom, null)
  set(dwHoldoutRangeAtom, null)
  set(dwCustomIntervalAtom, null)
  set(dwSourceFetchConfigsAtom, {})
  set(dwFetchConfigAtom, { ...DEFAULT_FETCH_CONFIG })
  set(dwFetchStateAtom, { status: 'idle', progress: 0 })
  set(dwFetchProgressAtom, { ...EMPTY_FETCH_PROGRESS })
  set(dwRawDatasetAtom, EMPTY_DATASET)

  // Step 3
  set(dwCropRangeAtom, null)
  set(dwValueCropAtom, {})
  set(dwValueClipAtom, {})
  set(dwExclusionsAtom, [])
  set(dwConditionalRulesAtom, [])
  set(dwStatisticalRulesAtom, [])
  set(dwCleaningPipelinesAtom, {})
  set(dwCleaningTagsAtom, [])
  set(dwCleanedTagsAtom, [])
  set(dwSelectedTagKeysAtom, new Set<string>())

  // Step 4
  set(dwFeatureConfigsAtom, [])
  set(dwFeaturePresetAtom, null)
  set(dwTargetTagAtom, null)
  set(dwSdtaPresetsAtom, [])
  set(dwSelectedColumnsAtom, null)
  set(dwScalerConfigsAtom, {})

  // Draft-first server state. THE GROUP THAT CAUSED THE DRIFT — a stale
  // preview sample is what leaked the previous dataset's tags into a fresh
  // create run, because the sidebar and every chart read their tag list from
  // it, not from the atoms that WERE being cleared.
  set(dwDraftIdAtom, null)
  set(dwDraftArtifactIdAtom, null)
  set(dwDraftFeatureArtifactIdAtom, null)
  set(dwDraftGoldArtifactIdAtom, null)
  set(dwBronzeWarmStateAtom, 'idle')
  set(dwGoldWarmErrorAtom, null)
  set(dwFeatureWarmStateAtom, 'idle')
  set(dwFeatureArtifactStampAtom, null)
  set(dwDraftSyncStateAtom, { status: 'idle' })
  set(dwFeaturePreviewSampleAtom, brandBoundedSample({ tags: [], rows: [] }))
  set(dwFeaturePreviewSampleStateAtom, 'idle')

  // Analysis selection
  set(dwHiddenTagsAtom, [])
  set(dwFocusedTagAtom, '')
  set(dwTagSidebarCollapsedAtom, false)

  // Nav + mode
  set(dwCurrentStepAtom, 1)
  set(dwHighestUnlockedAtom, 1)
  set(dwModeAtom, 'create')
  set(dwEditingDatasetIdAtom, '')
  set(dwEditingDatasetAtom, null)
  set(dwRowSourceAtom, null)
  set(dwSyntheticReasonAtom, null)
  set(dwRowStageAtom, null)
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
    // DS-LAKE-023 fix: this init never used to touch these two, unlike
    // `initDatasetWizardAtom`/`resetDatasetWizardAtom` which both null them.
    // A create session that switches into editing a different dataset in the
    // same tab (no route-level remount — this is an SPA nav, not a fresh
    // page load) left a FOREIGN draft id live; every draft-scoped call
    // (bronze warm, features job, holdout resplit) then fired against
    // someone else's draft instead of no-opping the way a truly fresh edit
    // session does.
    set(dwDraftIdAtom, null)
    set(dwDraftArtifactIdAtom, null)

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
    // Legacy recipes predate the holdout field — hydrate to null, same as
    // valueCrop/exclusions above. CORRECTED (DS-LAKE-023 edit-mode pass):
    // this used to say edit mode's picker "stays disabled... display-only
    // provenance, not a re-openable control" — that was true only in the
    // sense that it never actually worked (the picker's own enabled state
    // and the resplit hook's own no-op guard could never both hold at
    // once, see that hook's doc comment). IN PROGRESS as of 2026-08-25:
    // edit mode's picker is now HONESTLY gated instead — it stays disabled
    // until the draft's current source artifact is the cleaned SILVER
    // (i.e. until the user has run Step 5's "Save Cleaned Tags" at least
    // once this session), because seeding a fresh raw BRONZE at Step 4
    // mount was found to skip cleaning entirely (see
    // `useDatasetGoldWarm`'s own doc comment). Once unlocked, it uses the
    // SAME feature-bearing split Step 4 uses for create mode.
    set(dwHoldoutRangeAtom, config.holdoutDateRange ?? null)
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
    set(dwRowStageAtom, null)

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
    set(dwSdtaPresetsAtom, [])

    set(dwHiddenTagsAtom, [])
    set(dwFocusedTagAtom, '')
    set(dwTagSidebarCollapsedAtom, false)
    // Hygiene only — these atoms are never SET by a fresh edit-mode session
    // before Step 4 mounts (see dwDraftFeatureArtifactIdAtom's own doc
    // comment), but a prior create-mode session in the same tab could leave
    // them populated before the user switches into editing a different
    // dataset.
    set(dwDraftFeatureArtifactIdAtom, null)
    set(dwFeatureWarmStateAtom, 'idle')
    set(dwFeatureArtifactStampAtom, null)

    // DS-LAKE-022-T04..T07 landed edit mode on Step 5 directly, reasoning
    // that its only editable surface (cleaning) lives there and Step 3's
    // EDA is nothing edit mode can change. DS-LAKE-023 changes that
    // reasoning: Step 4 is now ALSO editable in edit mode (the holdout
    // window, recipe still locked — see A4's `ensureDraft`/`ensureBronze`
    // call at Step 4 mount), so landing straight on Step 5 skipped past a
    // step worth seeing on the way in. Land on Step 3 instead and let the
    // wizard's own forward nav carry the user through Step 4 naturally.
    // `dwHighestUnlockedAtom` stays every step — this only moves where
    // edit mode FIRST lands, not what is reachable via the step indicator.
    set(dwCurrentStepAtom, 3)
    set(dwHighestUnlockedAtom, DW_TOTAL_STEPS)
  },
)
