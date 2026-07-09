import { buildRawDataset, preprocess } from '@/lib/preprocessing'
import type { Dataset, FillStrategyConfig } from '@/lib/preprocessing'
import { precleanse } from '@/lib/precleanse'
import type {
  ConditionalRule,
  CropRange,
  StatisticalRule,
} from '@/lib/precleanse'
import { applyFeatures } from '@/lib/feature-engineering'
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
  conditionalRules: ConditionalRule[]
  statisticalRules: StatisticalRule[]
  fillStrategies: Record<string, FillStrategyConfig>
}

/** Fixed clock so a saved recipe re-derives identical rows on every call. */
const MATERIALIZE_EPOCH = Date.UTC(2026, 0, 1)

export const EMPTY_PIPELINE_CONFIG: PipelineConfig = {
  timeRange: '1min',
  customDateRange: null,
  customInterval: null,
  sourceFetchConfigs: {},
  features: [],
  cropRange: null,
  conditionalRules: [],
  statisticalRules: [],
  fillStrategies: {},
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
    conditional: config.conditionalRules,
    statistical: config.statisticalRules,
  })
  return preprocess(cleansed, config.fillStrategies)
}
