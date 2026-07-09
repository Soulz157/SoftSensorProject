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
import type { MetricKey } from '@/lib/model-metrics'
import type { Algorithm } from '@/store/model-pipeline'
import type { AIModel } from '@/types'

export interface ModelConfig {
  description?: string
  /** The `Dataset` this model was trained on — also mirrored on `Model.datasetId`. */
  datasetId: string
  algorithm: Algorithm
  targetVariable: string
  hyperparameters: Record<string, number>
  selectedMetrics?: MetricKey[]
}

export interface BuildModelConfigInput {
  description?: string
  datasetId: string
  algorithm: Algorithm
  targetVariable: string
  hyperparameters: Record<string, number>
  selectedMetrics?: MetricKey[]
}

/** Assemble the persistable config from current wizard atom values. */
export function buildModelConfig(input: BuildModelConfigInput): ModelConfig {
  return {
    ...(input.description && input.description.trim() !== ''
      ? { description: input.description }
      : {}),
    datasetId: input.datasetId,
    algorithm: input.algorithm,
    targetVariable: input.targetVariable,
    hyperparameters: input.hyperparameters,
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
