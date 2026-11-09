import type { CalBasis, SummaryType } from '@/types/pi'
import { resolveInterval } from '@/lib/dataset-fetch'
import type {
  CustomInterval,
  DataSourceConfig,
  FetchPeriod,
} from '@/store/model-pipeline'

/**
 * Historical-fetch configuration for the PI archive summary read (Step 5 of the
 * verification → fetch workflow). Distinct from per-source connection config
 * (`DataSourceConfig`): these are the PI Web API *summary* parameters that shape
 * a `POST /:id/fetch` request — calculation basis, summary aggregate(s),
 * bucket duration, and tag batch size.
 *
 * `summaryDuration` is the bucket size (e.g. "1m", "10m", "1h"). Empty string
 * means "derive from the wizard's Fetch Period", so the existing period/interval
 * control stays the default source of truth and this field is an override.
 *
 * Field names mirror the FetchParamsDto camelCase contract (backend maps them to
 * the Python snake_case DataFetchRequest). Timezone is intentionally NOT here —
 * the Python connector does not accept one yet (deferred, P4b).
 */
export interface HistoricalFetchConfig {
  calBasis: CalBasis
  summaryType: SummaryType[]
  summaryDuration: string
  batchSize: number
}

export const DEFAULT_FETCH_CONFIG: HistoricalFetchConfig = {
  calBasis: 'TimeWeighted',
  summaryType: ['Average'],
  summaryDuration: '',
  batchSize: 300,
}

export const CAL_BASIS_OPTIONS: { value: CalBasis; label: string }[] = [
  { value: 'TimeWeighted', label: 'Time weighted' },
  { value: 'EventWeighted', label: 'Event weighted' },
  { value: 'TimeWeightedContinuous', label: 'Time weighted (continuous)' },
]

export const SUMMARY_TYPE_OPTIONS: { value: SummaryType; label: string }[] = [
  { value: 'Average', label: 'Average' },
  { value: 'Minimum', label: 'Minimum' },
  { value: 'Maximum', label: 'Maximum' },
  { value: 'Total', label: 'Total' },
  { value: 'StdDev', label: 'Std dev' },
  { value: 'Count', label: 'Count' },
]

export const BATCH_SIZE_MIN = 1
export const BATCH_SIZE_MAX = 1000

/** Clamp a user-entered batch size into the connector's accepted range. */
export function clampBatchSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FETCH_CONFIG.batchSize
  return Math.min(BATCH_SIZE_MAX, Math.max(BATCH_SIZE_MIN, Math.trunc(value)))
}

/**
 * The Batch Size text box's own reading of what was typed: a whole number in
 * BATCH_SIZE_MIN..BATCH_SIZE_MAX, or null. Unlike `clampBatchSize` it never
 * rewrites the input — clamping on every keystroke turned a cleared field
 * into "1" and made a new value impossible to type.
 */
export function parseBatchSizeInput(raw: string): number | null {
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= BATCH_SIZE_MIN && n <= BATCH_SIZE_MAX ? n : null
}

/** The PI summary parameters one raw fetch sends. */
export interface PiSummaryParams {
  summaryDuration: string
  calBasis: CalBasis
  summaryType: SummaryType[]
  batchSize: number
}

/**
 * What EVERY raw PI fetch of a dataset sends - the BRONZE materialize and a
 * saved dataset's re-fetch (2026-10-19). Those used to send only the bucket
 * (or nothing: python then fell back to "1m", so a re-fetched hourly dataset
 * came back per-minute) and never the Historical Fetch Settings, so the rows
 * that trained could differ from the ones on screen.
 *
 * A recipe saved before `fetchConfig` was stored gets DEFAULT_FETCH_CONFIG,
 * which is exactly python's own defaults - how such a dataset was fetched.
 */
export function piSummaryParams(
  fetchConfig: HistoricalFetchConfig | undefined,
  period: FetchPeriod,
  customInterval: CustomInterval | null,
): PiSummaryParams {
  const cfg = fetchConfig ?? DEFAULT_FETCH_CONFIG
  return {
    summaryDuration:
      cfg.summaryDuration.trim() || resolveInterval(period, customInterval),
    calBasis: cfg.calBasis,
    summaryType: cfg.summaryType,
    batchSize: cfg.batchSize,
  }
}

/**
 * Every PI source config stamped with the dataset's real fetch settings
 * (2026-10-19). `pipelineConfig.sourceFetchConfigs[id]` is what an inference
 * schedule copies (`resolveSourceBinding`) and fetches with - `intervalTime`
 * as the bucket, `calcBasis` / `calcType` as `cal_basis` / `summary_type` -
 * but nothing in the wizard set them from the Interval control, so a model
 * trained on hourly rows scored per-minute ones. Non-PI configs pass through.
 */
export function withPiFetchSettings(
  configs: Record<string, DataSourceConfig>,
  params: PiSummaryParams,
): Record<string, DataSourceConfig> {
  const out: Record<string, DataSourceConfig> = {}
  for (const [id, cfg] of Object.entries(configs)) {
    out[id] =
      cfg.type === 'pi'
        ? {
            ...cfg,
            intervalTime: params.summaryDuration,
            calcBasis: params.calBasis,
            calcType: params.summaryType[0] ?? 'Average',
          }
        : cfg
  }
  return out
}
