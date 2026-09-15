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
}

export type DriftStatus = 'OK' | 'WARN' | 'CRITICAL' | 'UNKNOWN'

export interface DriftColumn {
  column: string
  n: number
  liveMean: number
  liveStd: number
  trainMean: number | null
  trainStd: number | null
  z: number | null
  outOfRangePct: number | null
  status: DriftStatus
  reason?: string
}

/**
 * MODEL-SERVE-001-T17. `plane` names which live data source produced this
 * report — `'window'` for a model with an `InferenceSchedule` (pooled from
 * `InferenceWindow.featureStats`/`featureHistograms`), `'predict'` for one
 * without (pooled from `PredictionLog`, MODEL-SERVE-005's original plane).
 * Decided by schedule PRESENCE server-side, never inferred client-side from
 * which fields happen to be populated. The five fields below `plane` are
 * populated ONLY on the window plane — a model with no schedule has no
 * window pool to describe, so they stay `undefined` there rather than
 * printing a false zero.
 */
export interface MonitoringBasis {
  plane: 'window' | 'predict'
  /** Windows fetched in `[from, to]` (≤24, the rolling horizon T17 itself
   *  specifies) — window plane only. */
  windowsUsed?: number
  /** Real earliest/latest `windowStart` in the pool — NEVER a printed
   *  "rolling 24h": that label would be false whenever the pool holds
   *  fewer than 24 windows or a shorter span. Window plane only. */
  windowStartEarliest?: string | null
  windowStartLatest?: string | null
  /** Per-`InferenceWindowStatus` counts across the pooled windows — the
   *  disclosure T17's own no-status-whitelist rule requires: a figure
   *  computed mostly from windows that never scored must say so. Window
   *  plane only. */
  statusBreakdown?: Record<string, number>
  /** Sum of `inputRows` across the pooled windows — window plane only. */
  totalInputRows?: number
}

export interface DriftReport {
  status: DriftStatus
  columns: DriftColumn[]
  basis: MonitoringBasis & {
    modelVersionId: string
    version: number
    goldArtifactId: string
    goldObjectKey: string
    sampleRequests: number
    from: string
    to: string
    /** Windows in the pool whose `featureStats` was non-null and actually
     *  fed `poolFeatureStats` — window plane only, mirroring `PsiReport`'s
     *  own `histogramRequests`. `windowsUsed` can exceed this whenever a
     *  window predates T17 or had no coverable feature column. */
    statsWindows?: number
  }
}

/**
 * MODEL-SERVE-001-T13. PSI (Population Stability Index) — published
 * ALONGSIDE `DriftReport`'s z-score, never replacing it. A DIFFERENT set
 * of statuses from `DriftStatus`: `INSUFFICIENT_DATA` is real information
 * (a reference exists, live traffic just has not cleared the sample floor
 * yet) distinct from `UNKNOWN` (no reference at all) — see
 * `apps/backend/src/lib/prediction-psi.ts`'s own module docstring.
 */
export type PsiStatus =
  | 'OK'
  | 'WARN'
  | 'CRITICAL'
  | 'UNKNOWN'
  | 'INSUFFICIENT_DATA'

/**
 * MODEL-SERVE-001-T16. Per-column raw bin data — mirrors the backend's
 * `ColumnBins` (`apps/backend/src/lib/prediction-psi.ts`) verbatim. `null`
 * exactly when `PsiColumn.status` is `UNKNOWN` — no training reference
 * exists for this column. Present on every OTHER status, INCLUDING
 * `INSUFFICIENT_DATA`: that row still needs `liveInRangeTotal`/`below`/
 * `above`/`minSamples` to print "412 of 600 rows".
 *
 * NEVER a license to draw a chart below the sample floor — see
 * `PsiPanel`'s own render rule: an `INSUFFICIENT_DATA` row is not
 * clickable, and `bins` there is for the rows-vs-floor readout only.
 */
export interface ColumnBins {
  binMode: 'continuous' | 'categorical'
  /** RESOLVED count, never a default assumed — a degenerate tag's reduced
   *  bin count must be visible, never presumed to be 10. */
  binCount: number
  /** Frozen at training time, RAW engineering units — `edges[i]`..
   *  `edges[i+1]` is bin `i` in `continuous` mode (last bin closed on the
   *  right); in `categorical` mode each entry in `edges` IS the bin (one
   *  per trained value), so `edges.length === binCount` there, never
   *  `binCount + 1`. */
  edges: number[]
  /** MEASURED reference population per bin — never assumed uniform (a
   *  categorical split is not equal-frequency the way a quantile split
   *  is). */
  refCounts: number[]
  liveCounts: number[]
  below: number
  above: number
  /** PSI's OWN denominator — `sum(liveCounts)`, EXCLUDING below/above. */
  liveInRangeTotal: number
  /** `binCount * minSamplesPerBin` — the floor `liveTotal` is tested
   *  against. */
  minSamples: number
}

export interface PsiColumn {
  column: string
  liveTotal: number
  /** Null exactly when `status` is `UNKNOWN` or `INSUFFICIENT_DATA` — a
   *  number here always means a real, computed PSI, never a placeholder. */
  psi: number | null
  /** Live mass OUTSIDE the trained reference edges, as a percentage of
   *  `liveTotal` — a REAL measured count, never folded into `psi` itself
   *  (the reference has no defined mass outside its own edges to compare
   *  against — see the backend module's own doc comment). This is the
   *  ONE rendered overflow figure; a drill-down's flanking bars/table row
   *  derive their own display from `bins.below`/`bins.above` directly,
   *  never a second independently-computed percentage. */
  outOfRangePct: number | null
  status: PsiStatus
  reason?: string
  /** See `ColumnBins`'s own doc comment for exactly when this is null. */
  bins: ColumnBins | null
}

export interface PsiReport {
  status: PsiStatus
  columns: PsiColumn[]
  basis: MonitoringBasis & {
    modelVersionId: string
    version: number
    goldArtifactId: string
    goldObjectKey: string
    /** WINDOW PLANE: windows fetched in [from, to] for the PRODUCTION
     *  version (≤24), same value as `windowsUsed`. PREDICT PLANE: requests
     *  found in [from, to], BEFORE the null-`featureHistograms` filter —
     *  kept for parity with `DriftReport`'s own `sampleRequests`. Either
     *  way, overstates what actually fed the PSI pool whenever a row
     *  predates T13/T17 or was served under a pre-T13 spec;
     *  `histogramRequests` below is the honest count for that. */
    sampleRequests: number
    /** Rows (requests on the predict plane, windows on the window plane)
     *  that actually carried a `featureHistograms` entry and fed
     *  `poolHistograms` — the number a "computed over" readout should
     *  print. */
    histogramRequests: number
    from: string
    to: string
    /** The env-derived thresholds `computePsi` was called with — read
     *  these for the on-screen disclaimer rather than a hardcoded literal,
     *  so the two can never silently drift apart. */
    thresholds: {
      warn: number
      critical: number
      minSamplesPerBin: number
    }
    /** The floor substituted for a zero bin proportion before `ln` — T13's
     *  own instruction that this must be STATED, never hidden in a
     *  constant. */
    epsilon: number
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

  /** Live inputs vs. the PRODUCTION version's own training distribution.
   *  404s when the model has no PRODUCTION version — callers should treat
   *  that as "nothing to show", not an error toast. */
  drift: (
    modelId: string,
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<DriftReport>> =>
    fetchClient(`${base(modelId)}/drift?${rangeQuery(from, to)}`, {
      method: 'GET',
      signal,
    }),

  /** MODEL-SERVE-001-T13. SEPARATE CADENCE from `drift` above (T13's own
   *  resolved openDecision #2): PSI needs `binCount * PSI_MIN_SAMPLES_PER_BIN`
   *  live samples before a figure is computed at all, which usually needs a
   *  wider `[from, to]` than the z-score's own request — callers should
   *  default this range wider (e.g. a rolling 24h) rather than reusing
   *  whatever range `drift` was just called with. 404s the same way
   *  `drift` does when the model has no PRODUCTION version. */
  psi: (
    modelId: string,
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<PsiReport>> =>
    fetchClient(`${base(modelId)}/psi?${rangeQuery(from, to)}`, {
      method: 'GET',
      signal,
    }),

  /** The trained X/Y schema for the Input Data tab — does not vary with a
   *  time range, unlike `predictions`/`drift` above. Never 404s for "no
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
   *  range — it is a "right now" snapshot, unlike `drift`/`psi` above. */
  inputStatus: (
    modelId: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<ModelInputStatus>> =>
    fetchClient(`${base(modelId)}/input-status`, {
      method: 'GET',
      signal,
    }),
}
