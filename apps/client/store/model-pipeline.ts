import { atom } from 'jotai'
import type { TimeRange } from '@/lib/mock-readings'
import type { Dataset, FillStrategyConfig } from '@/lib/preprocessing'
import type {
  ConditionalRule,
  CropRange,
  StatisticalRule,
} from '@/lib/precleanse'
import type { SavedDataset } from '@/store/datasets'
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
  /**
   * Latest log line from the container (MODEL-FLOW-003-T09). A fit has no
   * reportable percentage — train.py emits log lines, not a fraction — so
   * this is what the UI shows in place of a fake progress bar while RUNNING.
   */
  lastLog?: string
}

export const MP_TOTAL_STEPS = 6

// Wizard — Step 1: Select Dataset (+ model metadata), Step 2: Dataset Review
// (MODEL-FLOW-010), Step 3: Training Configuration, Step 4: Model Selection
// (MODEL-FLOW-013), Step 5: Evaluation, Step 6: Save Model. Dataset ETL now
// lives entirely in Data Studio (`store/dataset-studio.ts`); the model
// wizard only references a saved `Dataset` by id + its cached snapshot
// (avoids a refetch on every render).
export const mpSelectedDatasetAtom = atom<SavedDataset | null>(null)

export type Algorithm =
  | 'ols'
  | 'ridge'
  | 'hist_gradient_boosting'
  | 'svm'
  | 'mlp'
  | 'grp'
  | 'pls'
  | 'random_forest'
  | 'lightgbm'
  | 'xgboost'
  | 'lstm'
  | 'gru'
export const ALGORITHMS: Algorithm[] = [
  'ols',
  'ridge',
  'hist_gradient_boosting',
  'svm',
  'mlp',
  'grp',
  'pls',
  'random_forest',
  'lightgbm',
  'xgboost',
  'lstm',
  'gru',
]
export const ALGORITHM_LABELS: Record<Algorithm, string> = {
  ols: 'Linear Regression',
  ridge: 'Ridge Regression',
  hist_gradient_boosting: 'Histogram Gradient Boosting',
  svm: 'Support Vector Machine',
  grp: 'Gaussian Process Regression',
  mlp: 'MLP (Neural Network)',
  pls: 'PLS Regression',
  random_forest: 'Random Forest',
  xgboost: 'XGBoost',
  lightgbm: 'LightGBM',
  lstm: 'LSTM',
  gru: 'GRU',
}

/** A single hyperparameter value — numeric, categorical, boolean, or "none" (e.g. unlimited depth). */
export type HyperparamValue = number | string | boolean | null

export const mpAlgorithmAtom = atom<Algorithm>('ols')
/** Up to 3 candidate algorithms. `mpAlgorithmAtom` mirrors the primary (index 0). */
export const mpAlgorithmsAtom = atom<Algorithm[]>(['ols'])
/** AutoML Step A — evaluate the selected algorithms and auto-pick the best. */
export const mpFindBestModelAtom = atom<boolean>(false)
/** AutoML Step B — hyperparameter-tune the best model (requires Step A). */
export const mpFindBestParamsAtom = atom<boolean>(false)
export const mpTargetVariableAtom = atom<string[]>([])
export const mpHyperparamsAtom = atom<Record<string, HyperparamValue>>({})
/** Evaluation metric optimized during training. See `LOSS_OPTIONS` in `lib/training-config`. */
export const mpLossFunctionAtom = atom<string>('mse')
/** Train split percentage (test = 100 − this). Default 80/20. */
export const mpTrainTestSplitAtom = atom<number>(80)
/** MODEL-FLOW-014-T06. The Split Distribution panel's own tag selection —
 * ephemeral wizard-session state, NOT a ModelDraft column (the panel has no
 * server state of its own, per T05's own finding). Read by
 * `use-model-training.ts` at launch so the frozen `splitStats` sidecar
 * matches what the panel actually displayed, not an approximation. */
export const mpSplitStatsTagsAtom = atom<string[]>([])
/** MODEL-FLOW-014-T07. The estimator seed — `undefined` means "the user did
 * not choose one", distinct from an explicit value like `42`: the server
 * generates its own random seed when this is omitted
 * (model-run-launch.authorized.service.ts), and collapsing "not chosen"
 * into a default would make a run's reproducibility claim silently wrong.
 * Bounds match CreateTrainingRunSchema.seed: 1-2147483646. */
export const mpSeedAtom = atom<number | undefined>(undefined)

/** MODEL-FLOW-016-T10. `undefined` means Cross-Validation is OFF — the run
 * launches with the ordinary chronological `trainTestSplit` above, exactly
 * as before this feature. A number (3-10) means CV is ON with that many
 * expanding folds; `trainTestSplit` is then ignored at launch (the two are
 * mutually exclusive server-side — CreateTrainingRunSchema's own .refine()).
 * CLIENT-ONLY, deliberately: `ModelDraft` has no column for this (this
 * feature's own acceptance criterion forbids adding one — see the ledger's
 * ModelDraft-has-no-column finding), so `useModelDraftSync`'s PATCH never
 * carries it and a resumed draft always comes back with CV off. The value
 * is committed into the run's own `splitSpec` only at Start Training. */
export const mpNSplitsAtom = atom<number | undefined>(undefined)

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

export const mpSelectedDatasetIdAtom = atom<string | null>(null)

export const mpSelectedDatasetIdsAtom = atom<string[]>([])

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

// --- Model Draft workspace (client-only; MODEL-FLOW-002) -------------------
// The wizard's "Model Draft" is the in-memory collection of `mp*` atoms — it has
// NO backend record. Per the refactor invariant, the persistent `Model` row is
// created ONLY by Save Model (Step 4); training and evaluation operate on this
// draft. Draft state lives entirely here so no DB write happens before Save.
export type DraftState = 'draft' | 'trained' | 'saved'

/** Ephemeral client id for the current draft session (regenerated on wizard reset). */
export const mpDraftIdAtom = atom<string>('')
/** Draft lifecycle: 'draft' → 'trained' (Step 2 done) → 'saved' (Step 4 commit). */
export const mpDraftStateAtom = atom<DraftState>('draft')

/**
 * Server-side ModelDraft id (MODEL-FLOW-002), distinct from mpDraftIdAtom
 * above — that one is a purely client-local session id with no backend
 * record; this one IS the row a training container reads its spec from.
 * null until Step 1 -> 2 first creates it. Cleared on every wizard reset,
 * same as mpDraftIdAtom, so a fresh wizard run never inherits a stale
 * draft's id.
 */
export const mpServerDraftIdAtom = atom<string | null>(null)

/**
 * Training summary produced in Step 2, sourced from a real ModelTrainingRun
 * (MODEL-FLOW-003-T05) — no longer a mock. `metrics` is denormalised from
 * the run's own `metrics.json` sidecar and passed through as-is; mapping it
 * onto the Step 3 Evaluation UI's specific metric keys is the next
 * feature's job, not this one's.
 */
export interface DraftTrainingResult {
  runId: string
  algorithm: Algorithm
  metrics: Record<string, unknown> | null
  trainedAt: string
  /** MODEL-FLOW-016-T11. Set only for a Cross-Validation run — Step 4's
   *  single-run pass-through keys its mean±std render off this, never
   *  `algorithm`. Always null from the sweep-winner path (`pollJob` below):
   *  CV and Find Best Model are mutually exclusive by construction. */
  cvFoldsKey: string | null
}
export const mpTrainingResultAtom = atom<DraftTrainingResult | null>(null)

/**
 * MODEL-FLOW-013. Set when Start Training launches an algorithm-sweep
 * candidate job (Find Best Model) rather than a single run — Step 4 (Model
 * Selection) reads this to fetch the job's candidates; null means an
 * ordinary single-run launch, which Step 4 passes through honestly with no
 * comparison table. Reset everywhere `mpTrainingResultAtom` already is.
 */
export const mpCandidateJobIdAtom = atom<string | null>(null)

/** Mock evaluation summary produced in Step 3 (client-computed metrics). */
export interface DraftEvaluationResult {
  metrics: Partial<Record<MetricKey, number>>
  evaluatedAt: string
}
export const mpEvaluationResultAtom = atom<DraftEvaluationResult | null>(null)

/**
 * Object-storage key of the trained model artifact (MODEL-FLOW-003-T06) —
 * the completed run's own `modelKey`, under `drafts/{draftId}/runs/{runId}/`
 * until Save Model adopts it by pointer.
 */
export const mpArtifactRefAtom = atom<string | null>(null)

// MODEL-FLOW-005/013: candidate-job orchestration (algorithm sweep) lives
// server-side on ModelCandidateJob; the client only tracks its id
// (mpCandidateJobIdAtom, above) and polls it the same way it polls a single
// run. Hyperparameter search over a sweep's winner ("Find Best Parameters")
// remains unbuilt — see automl-toggles.tsx's disabled state.

// Step 4 — Deploy (advanced MLOps guardrails). Captured config only; persisted
// to `Model.data.config.deployment`. No runtime retrain/drift engine yet.
/** Master toggle for the auto-retrain policy. */
export const mpAutoRetrainAtom = atom<boolean>(false)
/** Layer 1 (Warning, amber) — tighter ±SD band. Invariant: warn < critical. */
export const mpRetrainWarnSdAtom = atom<number>(1.5)
/** Layer 2 (Critical, red) — wider ±SD band; reaching it triggers auto-retrain. */
export const mpRetrainCriticalSdAtom = atom<number>(3.0)
/** Master toggle for input-sensor drift monitoring. */
export const mpDriftMonitorAtom = atom<boolean>(false)
/** Max allowed live-input deviation (%) from the training baseline before a Drift Alarm. */
export const mpDriftThresholdPctAtom = atom<number>(10)

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
  set(mpSelectedDatasetAtom, null)
  set(mpAlgorithmAtom, 'ols')
  set(mpAlgorithmsAtom, ['ols'])
  set(mpFindBestModelAtom, false)
  set(mpFindBestParamsAtom, false)
  set(mpTargetVariableAtom, [])
  // Default algorithm is `ols` — seed its clean hyperparameters (mirrors
  // `defaultHyperparams('ols')`; inlined to avoid a store → training-config cycle).
  set(mpHyperparamsAtom, { fit_intercept: true })
  set(mpLossFunctionAtom, 'mse')
  set(mpTrainTestSplitAtom, 80)
  set(mpSplitStatsTagsAtom, [])
  set(mpSeedAtom, undefined)
  set(mpTrainStateAtom, { status: 'idle', progress: 0 })
  set(mpCreatedModelIdAtom, '')
  set(mpSelectedMetricsAtom, [...METRIC_KEYS])
  // Fresh Model Draft workspace (client-only) — new id, clean lifecycle/results.
  set(mpDraftIdAtom, nanoid())
  set(mpDraftStateAtom, 'draft')
  set(mpTrainingResultAtom, null)
  set(mpCandidateJobIdAtom, null)
  set(mpEvaluationResultAtom, null)
  set(mpArtifactRefAtom, null)
  // Server-side ModelDraft id — a fresh wizard run must not inherit a
  // previous run's draft, the same reasoning the dataset wizard's own
  // resetDatasetWizardAtom states for dwDraftIdAtom.
  set(mpServerDraftIdAtom, null)
  set(mpAutoRetrainAtom, false)
  set(mpRetrainWarnSdAtom, 1.5)
  set(mpRetrainCriticalSdAtom, 3.0)
  set(mpDriftMonitorAtom, false)
  set(mpDriftThresholdPctAtom, 10)
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
  piName?: string
  piServerUrl: string
  calcType: 'Average' | 'Interpolated' | 'Recorded'
  calcBasis: 'TimeWeighted' | 'EventWeighted'
  intervalTime: string
  userName?: string
  password?: string
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
  piName: '',
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
