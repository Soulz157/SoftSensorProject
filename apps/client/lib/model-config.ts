/**
 * Per-model wizard configuration — the data-source / tags / time-range /
 * processing selections captured by the Create Model wizard, persisted to
 * `Model.data.config` so Edit can pre-fill every phase and Duplicate can clone
 * an existing model's setup.
 *
 * Pure module (no React / IO). Holds the single source of truth for the
 * persisted shape plus the build (atoms → config) and read (model → config)
 * mappings, keeping the wizard hooks/components thin.
 */
import type { SavedDataSource } from '@/lib/mock-data-sources'
import type { FillStrategyConfig } from '@/lib/preprocessing'
import type { CustomDateRange } from '@/store/data-visualize'
import type { FetchPeriod } from '@/store/model-pipeline'
import type { MetricKey } from '@/lib/model-metrics'
import type { AIModel } from '@/types'

export interface ModelConfig {
  description?: string
  /** Full snapshot so a session-only source survives a reload/clone. */
  dataSource: SavedDataSource | null
  savedSourceId: string
  selectedTags: string[]
  timeRange: FetchPeriod
  customDateRange: CustomDateRange | null
  fillStrategies: Record<string, FillStrategyConfig>
  selectedMetrics?: MetricKey[]
}

export interface BuildModelConfigInput {
  description?: string
  savedSources: SavedDataSource[]
  savedSourceId: string
  selectedTags: string[]
  timeRange: FetchPeriod
  customDateRange: CustomDateRange | null
  fillStrategies: Record<string, FillStrategyConfig>
  selectedMetrics?: MetricKey[]
}

/** Assemble the persistable config from current wizard atom values. */
export function buildModelConfig(input: BuildModelConfigInput): ModelConfig {
  const dataSource =
    input.savedSources.find(s => s.id === input.savedSourceId) ?? null
  return {
    ...(input.description && input.description.trim() !== ''
      ? { description: input.description }
      : {}),
    dataSource,
    savedSourceId: input.savedSourceId,
    selectedTags: input.selectedTags,
    timeRange: input.timeRange,
    customDateRange: input.customDateRange,
    fillStrategies: input.fillStrategies,
    ...(input.selectedMetrics
      ? { selectedMetrics: input.selectedMetrics }
      : {}),
  }
}

/** Read a persisted config off a model, or null when it predates this feature. */
export function readModelConfig(model: AIModel): ModelConfig | null {
  const config = (model.data as { config?: ModelConfig } | null)?.config
  return config ?? null
}
