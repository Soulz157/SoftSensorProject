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
  ValueCrop,
} from '@/lib/precleanse'
import { applyFeatures, selectColumns } from '@/lib/feature-engineering'
import type { FeatureConfig } from '@/lib/feature-engineering'
import type { PresetSummary } from '@/lib/feature-preset'
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
  /**
   * DS-LAKE-018-T01: the raw validation holdout window, selected beside
   * `customDateRange` at Step 2. Optional and nullable (not just nullable):
   * absent entirely on every recipe saved before this field existed, and
   * legitimately null on any recipe that opted out of a holdout. Both
   * collapse to "no holdout" — a dataset with neither behaves exactly as
   * today (acceptance criterion). T03 reads this to split BRONZE.
   */
  holdoutDateRange?: CustomDateRange | null
  customInterval: CustomInterval | null
  sourceFetchConfigs: Record<string, DataSourceConfig>
  features: FeatureConfig[]
  cropRange: CropRange
  /**
   * Per-tag Y-axis crop from Drag-to-Crop. Authored in step 3 and load-bearing
   * for `canAdvance`, but historically dropped at save — recipes saved before
   * this field existed re-materialize without it. Optional for those.
   */
  valueCrop?: ValueCrop
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
  /**
   * Provenance of an applied soft-sensor preset, so re-opening the recipe in
   * edit mode shows where the equations came from. Optional — most recipes
   * were never built from a preset.
   */
  featurePreset?: PresetSummary
  /**
   * The preset's target (Y), independent of `baseTags`/dataset `tags`: it may
   * legitimately be absent from both when the lab measurement has not been
   * joined yet. Null and undefined both mean "no preset target" — kept
   * nullable rather than defaulted to '' so the wizard atom and the persisted
   * recipe agree on what "absent" looks like.
   */
  targetTag?: string | null
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
  valueCrop: {},
  exclusions: [],
  conditionalRules: [],
  statisticalRules: [],
  cleaningPipelines: {},
  selectedColumns: null,
  scalers: {},
}

/**
 * Run a saved recipe over an ALREADY-BUILT raw dataset.
 *
 * Extracted so the recipe applies identically whether the raw rows came from
 * `buildRawDataset` (synthetic) or from a committed artifact in object storage
 * (real). Two copies of this chain would be two places for the transform order
 * to drift, and drift here surfaces only as numbers that quietly disagree
 * between the two paths.
 */
export function applyRecipeTo(raw: Dataset, config: PipelineConfig): Dataset {
  const featured = applyFeatures(raw, config.features)
  const cleansed = precleanse(featured, {
    crop: config.cropRange,
    valueCrop: config.valueCrop,
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

/**
 * Rebuild the processed `Dataset` from a saved recipe using SYNTHETIC raw rows.
 *
 * Deterministic — same `tags` + `config` always yield the same rows — but the
 * rows are generated from a seed, not read from the source. This is the legacy
 * path, kept for datasets that have no committed artifact and no replayable
 * recipe. Prefer `materializeFromVersion` wherever stored rows are available,
 * and never present this output without saying it is synthetic.
 */
export function materializeDataset(
  tags: string[],
  config: PipelineConfig,
): Dataset {
  return applyRecipeTo(
    buildRawDataset(tags, PERIOD_TO_RANGE[config.timeRange], MATERIALIZE_EPOCH),
    config,
  )
}

/**
 * Apply a saved recipe to REAL rows read from a committed dataset version.
 *
 * Same transform chain as `materializeDataset`; only the source of the raw rows
 * differs. Kept as a separate named export rather than an optional argument so
 * call sites read unambiguously as one or the other — which of the two produced
 * a number on screen is exactly what a reader needs to know.
 */
export function materializeFromVersion(
  raw: Dataset,
  config: PipelineConfig,
): Dataset {
  return applyRecipeTo(raw, config)
}
