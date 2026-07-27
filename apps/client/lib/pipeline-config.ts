import {
  buildRawDataset,
  preprocess,
  preprocessPipelines,
  toModelReady,
} from '@/lib/preprocessing'
import type {
  Dataset,
  FillStrategyConfig,
  ScalerMethod,
  TagPipeline,
} from '@/lib/preprocessing'
import { precleanse } from '@/lib/precleanse'
import type {
  ConditionalRule,
  CropRange,
  RangeExclusion,
  StatisticalRule,
} from '@/lib/precleanse'
import { applyFeatures, selectColumns } from '@/lib/feature-engineering'
import type { FeatureConfig } from '@/lib/feature-engineering'
import { PERIOD_TO_RANGE } from '@/store/model-pipeline'
import type {
  FetchPeriod,
  CustomInterval,
  DataSourceConfig,
} from '@/store/model-pipeline'
import type { CustomDateRange } from '@/store/data-visualize'

export interface PipelineConfig {
  timeRange: FetchPeriod
  customDateRange: CustomDateRange | null
  customInterval: CustomInterval | null
  sourceFetchConfigs: Record<string, DataSourceConfig>
  features: FeatureConfig[]
  cropRange: CropRange
  /** Drag-to-Crop "Exclude" bands (remove-inside spans). Optional for old recipes. */
  exclusions?: RangeExclusion[]
  conditionalRules: ConditionalRule[]
  statisticalRules: StatisticalRule[]
  /** Step 3.2 bulk cleaning — per-tag ordered pipeline. */
  cleaningPipelines: Record<string, TagPipeline>
  /** Legacy single-strategy fill map — kept for materializing old saved recipes. */
  fillStrategies?: Record<string, FillStrategyConfig>
  /** Columns (original + engineered) to keep; null = keep all. */
  selectedColumns: string[] | null
  /** Per-column model-ready scaler; missing key = min-max. */
  scalers: Record<string, ScalerMethod>
  /**
   * Step-1 selected source tags (pre feature-engineering). Distinct from the
   * saved dataset's final `tags` (post feature + column-select). Required to
   * rebuild the raw dataset when re-opening the recipe in edit mode. Optional
   * for legacy recipes saved before edit support existed.
   */
  baseTags?: string[]
  /** Per-tag constant for Manual/CSV tags — needed to reconstruct their series. */
  tagConstants?: Record<string, number>
}

/** Fixed clock so a saved recipe re-derives identical rows on every call. */
export const MATERIALIZE_EPOCH = Date.UTC(2026, 0, 1)

export const EMPTY_PIPELINE_CONFIG: PipelineConfig = {
  timeRange: '1min',
  customDateRange: null,
  customInterval: null,
  sourceFetchConfigs: {},
  features: [],
  cropRange: null,
  exclusions: [],
  conditionalRules: [],
  statisticalRules: [],
  cleaningPipelines: {},
  selectedColumns: null,
  scalers: {},
}

/**
 * Rebuild the processed `Dataset` from a saved recipe. Deterministic: same
 * `tags` + `config` always yield the same rows.
 */
export function materializeDataset(
  tags: string[],
  config: PipelineConfig,
): Dataset {
  const raw = buildRawDataset(
    tags,
    PERIOD_TO_RANGE[config.timeRange],
    MATERIALIZE_EPOCH,
  )
  const featured = applyFeatures(raw, config.features)
  const cleansed = precleanse(featured, {
    crop: config.cropRange,
    exclusions: config.exclusions,
    conditional: config.conditionalRules,
    statistical: config.statisticalRules,
  })
  // Prefer the bulk cleaning pipeline; fall back to legacy single-strategy fill
  // so recipes saved before this field still materialize identically.
  const filled = config.cleaningPipelines
    ? preprocessPipelines(cleansed, config.cleaningPipelines)
    : preprocess(cleansed, config.fillStrategies ?? {})
  // Legacy saved recipes predate these fields — tolerate their absence.
  const selected = selectColumns(filled, config.selectedColumns ?? null)
  return toModelReady(selected, config.scalers ?? {})
}
