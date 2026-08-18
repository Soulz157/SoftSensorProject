import type { CalBasis, SummaryType } from '@/types/pi'

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

/**
 * Toggle one summary aggregate in/out of the selection while guaranteeing at
 * least one stays selected (the fetch request requires a non-empty list, and an
 * empty aggregate set is never a meaningful request). Removing the last item is
 * a no-op.
 */
export function toggleSummaryType(
  current: SummaryType[],
  value: SummaryType,
): SummaryType[] {
  if (current.includes(value)) {
    const next = current.filter(t => t !== value)
    return next.length === 0 ? current : next
  }
  return [...current, value]
}

/** Clamp a user-entered batch size into the connector's accepted range. */
export function clampBatchSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FETCH_CONFIG.batchSize
  return Math.min(BATCH_SIZE_MAX, Math.max(BATCH_SIZE_MIN, Math.trunc(value)))
}
