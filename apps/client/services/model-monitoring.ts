import { fetchClient } from '@/lib/fetcher'
import type { ModelVersionNumber } from '@/lib/model-version-number'

/**
 * MODEL-SERVE-005. Sampled synchronous-/predict logging (T01) and the
 * distribution-drift signal (T02) — read side. Both endpoints live under
 * `authorized/model/:modelId`, matching `model-version`/`model.ts`'s own
 * prefix.
 */

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

export interface PredictionSeriesPoint {
  timestamp: string
  prediction: number
  features: Record<string, number>
  modelVersionId: string
}

export interface PredictionSeriesResult {
  points: PredictionSeriesPoint[]
  truncated: boolean
  /** MODEL-SERVE-008-T06. Whether this model's LIVE PREDICTION DRIVER is on
   *  — the switch that decides which of two empty states this section is
   *  in. Driver off: empty BY CONSTRUCTION, because only apps/serving's
   *  synchronous /predict writes here and a schedule never does
   *  (MODEL-SERVE-001-T10 Part A). Driver ON: something DOES write here, so
   *  an empty range means no point has landed yet — a different sentence,
   *  and naming the wrong one is worse than saying nothing. */
  livePredictEnabled: boolean
}

/**
 * MODEL-SERVE-036. Input-drift verdict by TRAINING RANGE (replaces PSI). A
 * live value below the training min or above the training max is drift; a
 * column is graded by the share of such values. `INSUFFICIENT_DATA` (a
 * range exists, too few live values) is distinct from `UNKNOWN` (no range
 * recorded at all) — see `apps/backend/src/lib/input-range-drift.ts`.
 */
export type InputDriftStatus =
  | 'OK'
  | 'WARN'
  | 'CRITICAL'
  | 'UNKNOWN'
  | 'INSUFFICIENT_DATA'

/**
 * Live vs training distribution for one column — mirrors the backend's
 * `ColumnBins`. For Deep Detail only; it grades nothing. `null` on a column
 * whose status is `UNKNOWN`.
 */
export interface ColumnBins {
  binMode: 'continuous' | 'categorical'
  /** The RESOLVED count — a degenerate tag's reduced bin count must be
   *  visible, never presumed to be 10. */
  binCount: number
  /** Frozen at training time, RAW engineering units — `edges[i]`..
   *  `edges[i+1]` is bin `i` in `continuous` mode (last bin closed on the
   *  right); in `categorical` mode each entry IS the bin (one per trained
   *  value). The outer edges are the training range. */
  edges: number[]
  /** MEASURED reference population per bin — never assumed uniform. */
  refCounts: number[]
  liveCounts: number[]
  below: number
  above: number
  /** `sum(liveCounts)`, EXCLUDING below/above. */
  liveInRangeTotal: number
  /** The grading floor — fewer live values than this are not graded. */
  minSamples: number
}

/** One scored window (window plane) or one hour of requests (predict
 *  plane). `below`/`above` come from the same counting rule as the column
 *  verdict, so a table row and the badge can never disagree. */
export interface InputDriftWindow {
  windowStart: string
  windowEnd: string
  n: number
  /** Null when `n` is 0. */
  min: number | null
  max: number | null
  mean: number | null
  below: number
  above: number
}

/** One point of a tag's trend. Raw resolution: one row, so min = max =
 *  value. Bucketed: the bucket mean with its own min and max kept, so a
 *  spike inside a bucket still reaches the chart. */
export interface InputTrendPoint {
  t: string
  value: number | null
  min: number | null
  max: number | null
  /** Rows in this point outside the training range. */
  outOfRange: number
}

export interface InputTrendSeries {
  resolution: 'raw' | 'bucketed'
  /** Bucket width when `resolution` is 'bucketed'. */
  bucketMinutes: number | null
  points: InputTrendPoint[]
  /** Newest first. */
  windows: InputDriftWindow[]
  liveMin: number | null
  liveMax: number | null
  liveMean: number | null
  lastOutOfRangeAt: string | null
}

export interface ColumnRangeDrift {
  column: string
  liveTotal: number
  below: number
  above: number
  /** Null when there is no training range or no live value. */
  outOfRangePct: number | null
  /** The training range: the reference's outer edges. Null exactly when
   *  `status` is UNKNOWN (no range recorded). */
  trainMin: number | null
  trainMax: number | null
  binMode: 'continuous' | 'categorical' | null
  status: InputDriftStatus
  reason?: string
  /** Live vs training distribution, for Deep Detail only — it does not
   *  grade anything. */
  bins: ColumnBins | null
}

export interface InputDriftReport {
  status: InputDriftStatus
  columns: ColumnRangeDrift[]
  /** The target (y), display only — never part of `status`. */
  targetColumn?: string | null
  target?: ColumnRangeDrift | null
  /** Keyed by column (target included). A column absent here had no live
   *  rows to plot. */
  series: Record<string, InputTrendSeries>
  basis: {
    plane: 'window' | 'predict'
    modelVersionId: string
    version: number
    from: string
    to: string
    /** Windows (or hours, on the predict plane) behind every figure in this
     *  report — badge, chart, stats and table alike. */
    windowsUsed: number
    /** The range was cut to the newest `maxDays` days. */
    capped: boolean
    maxDays: number
    /** /predict plane: the row read hit its limit, so the figures cover a
     *  sample of the range. Always false on the window plane. */
    truncated: boolean
    /** Windows whose input file could not be read. */
    missing: number
    /** Model health and alerts grade the newest N windows, not this range. */
    healthWindows: number
    thresholds: {
      outOfRangeWarnPct: number
      outOfRangeCriticalPct: number
      minSamples: number
    }
  }
}

/**
 * MODEL-SERVE-001-T15. PI's OWN per-tag quality for a model's feature
 * columns, read live. Defined here rather than imported from
 * `lib/mock-readings.ts` (where an identical-looking `SensorQuality` union
 * lives) deliberately — that module is mock data, and this is a real wire
 * contract.
 *
 * `UNKNOWN` means PI returned nothing for the tag, or could not be reached;
 * it never means Good. See the backend's
 * `model-input-status.authorized.service.ts` for why this cannot be read
 * from the stored pipeline instead.
 */
export type PiTagStatus = 'Good' | 'Questionable' | 'Bad' | 'UNKNOWN'

export interface FeatureTagStatus {
  column: string
  status: PiTagStatus
  reason?: string
  /** For a DERIVED feature: which of its base tags are not Good. The
   *  actionable half — at six source tags, "Bad" alone says nothing about
   *  which sensor to go look at. */
  failingSources?: string[]
  /** PI's current reading for a BASE tag; null for a derived feature, which
   *  PI has never heard of. */
  value?: number | string | null
  timestamp?: string | null
}

export interface ModelInputStatus {
  modelId?: string
  versionId?: string
  sourceId?: string
  features: FeatureTagStatus[]
  /** Non-null when the live read could not happen at all (PI unreachable, a
   *  source this user cannot read, no resolvable source). The tab shows its
   *  feature list regardless — only this one column degrades. */
  unavailableReason: string | null
}

/**
 * The Input Data tab's trained X/Y schema read — the ordered feature list
 * `run_manifest.json` recorded at train time, over `JwtAccessGuard` rather
 * than the machine-only `ServingTokenGuard` the descriptor endpoint sits
 * behind. `featureColumns`/`unavailableReason` are a pair: null/non-null
 * together, never independently — a legacy run with no recorded manifest
 * is a normal state (see `unavailableReason`), not a fetch error.
 */
export interface ModelInputSchema {
  modelId: string
  versionId: string
  /** MODEL-SERVE-001-T08. Branded — this is the number a caller passes to
   *  `modelVersionService.promote`, and it must never be typeable as a bare
   *  literal at the call site. */
  version: ModelVersionNumber
  stage: 'STAGING' | 'PRODUCTION' | 'ARCHIVED'
  /** The SERVING version's own recorded metrics — the ModelVersion row's
   *  snapshot (what promote's r2 floor checks and what serving reports),
   *  never recomputed client-side and never read off the source run.
   *  Any field is null when that number was not recorded; render it as
   *  "not recorded", never as 0. */
  metrics: {
    rmse: number | null
    r2: number | null
    mae: number | null
    /** Test-split residual SD (falls back to rmse on older versions). */
    sd: number | null
  }
  /** Ordered exactly as model.predict expects. Null only alongside a set
   *  `unavailableReason`. */
  featureColumns: string[] | null
  unavailableReason: string | null
  /** The trained run's own target — one column, not the wizard's
   *  (possibly multi-select) copy. See `configTargets` for that one. */
  targetY: string
  /** Per-tag fitted scaler params, keyed by tag; null when the sidecar is
   *  unreadable. Feed `inverseScale` one tag's entry at a time. NOT for the
   *  Input Data tab's own logged values — those are `/predict`'s raw
   *  request values, never scaled (see `lib/model-input-features.ts`'s own
   *  doc comment). This field exists for surfaces that DO invert a
   *  genuinely-scaled artifact value (DS-LAKE-025-T06). */
  scalingParams: Record<string, Record<string, number>> | null
  /** T12. A `formula` feature's human-readable equation, keyed by feature
   *  name — `[]` when the spec has none or could not be read. Names which
   *  SOURCE COLUMNS feed a derived tag; carries no per-tag status, because
   *  none exists on the `/predict` stream this tab reads. */
  derivedFeatures: Array<{ name: string; kind: string; display: string }>
}

function base(modelId: string): string {
  return `/api/v1/authorized/model/${modelId}`
}

function rangeQuery(from: string, to: string): string {
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
}

export const modelMonitoringService = {
  /** The logged prediction series for the Monitoring page — one point per
   *  raw logged row, read from the objects apps/serving wrote. `signal` is
   *  threaded through for `useDebouncedAbortableRequest`'s abort-on-
   *  supersede contract (hooks/dataset/internal). */
  predictions: (
    modelId: string,
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<PredictionSeriesResult>> =>
    fetchClient(`${base(modelId)}/predictions?${rangeQuery(from, to)}`, {
      method: 'GET',
      signal,
    }),

  /** MODEL-SERVE-036. Input drift by training range over `[from, to]`
   *  (capped server-side to 31 days): per tag, the verdict, the trend and
   *  the per-window stats behind it. 404s when the model has no PRODUCTION
   *  version — callers treat that as "nothing to show". */
  inputDrift: (
    modelId: string,
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<InputDriftReport>> =>
    fetchClient(`${base(modelId)}/input-drift?${rangeQuery(from, to)}`, {
      method: 'GET',
      signal,
    }),

  /** The trained X/Y schema for the Input Data tab — does not vary with a
   *  time range, unlike `predictions`/`inputDrift` above. Never 404s for "no
   *  PRODUCTION version": falls back to the model's latest version, since
   *  Save Model always mints at least one. */
  inputSchema: (
    modelId: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<ModelInputSchema>> =>
    fetchClient(`${base(modelId)}/input-schema`, {
      method: 'GET',
      signal,
    }),

  /** MODEL-SERVE-001-T15. Live PI quality per feature tag. A SEPARATE call
   *  from `inputSchema` on purpose: this one reaches PI, so it must be able
   *  to fail without taking the feature list down with it. Takes no time
   *  range — it is a "right now" snapshot, unlike `inputDrift` above. */
  inputStatus: (
    modelId: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<ModelInputStatus>> =>
    fetchClient(`${base(modelId)}/input-status`, {
      method: 'GET',
      signal,
    }),
}
