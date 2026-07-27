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
import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'
import type { AIModel } from '@/types'

/**
 * Advanced deploy-step guardrails (auto-retrain SD thresholds + input-sensor
 * drift monitor). Configuration only — no runtime engine yet.
 */
export interface DeploymentConfig {
  autoRetrain: boolean
  /** Layer 1 (Warning) ±SD band. Invariant: warnSd < criticalSd. */
  warnSd: number
  /** Layer 2 (Critical) ±SD band; reaching it triggers auto-retrain. */
  criticalSd: number
  driftMonitor: boolean
  /** Max allowed live-input deviation (%) before a Drift Alarm. */
  driftThresholdPct: number
}

export interface ModelConfig {
  description?: string
  /** The `Dataset` this model was trained on — also mirrored on `Model.datasetId`. */
  datasetId: string
  algorithm: Algorithm
  /** Candidate algorithms (multi-select, ≤3). `algorithm` is the primary. */
  algorithms?: Algorithm[]
  /** AutoML Step A — auto-pick the best of `algorithms`. */
  findBestModel?: boolean
  /** AutoML Step B — hyperparameter-tune the best model. */
  findBestParams?: boolean
  /** Tags the model predicts. Read via `configTargets` (handles legacy single). */
  targetVariables: string[]
  /** @deprecated pre-multi-select single target; read via `configTargets`. */
  targetVariable?: string
  hyperparameters: Record<string, HyperparamValue>
  /** Loss / evaluation metric optimized during training (e.g. `mse`). */
  lossFunction?: string
  /** Train split percentage; test = 100 − this. */
  trainTestSplit?: number
  selectedMetrics?: MetricKey[]
  /** Advanced deploy guardrails captured by the Deploy step (Step 4). */
  deployment?: DeploymentConfig
}

export interface BuildModelConfigInput {
  description?: string
  datasetId: string
  algorithm: Algorithm
  algorithms?: Algorithm[]
  findBestModel?: boolean
  findBestParams?: boolean
  targetVariables: string[]
  hyperparameters: Record<string, HyperparamValue>
  lossFunction?: string
  trainTestSplit?: number
  selectedMetrics?: MetricKey[]
  deployment?: DeploymentConfig
}

/** Assemble the persistable config from current wizard atom values. */
export function buildModelConfig(input: BuildModelConfigInput): ModelConfig {
  return {
    ...(input.description && input.description.trim() !== ''
      ? { description: input.description }
      : {}),
    datasetId: input.datasetId,
    algorithm: input.algorithm,
    ...(input.algorithms ? { algorithms: input.algorithms } : {}),
    ...(input.findBestModel !== undefined
      ? { findBestModel: input.findBestModel }
      : {}),
    ...(input.findBestParams !== undefined
      ? { findBestParams: input.findBestParams }
      : {}),
    targetVariables: input.targetVariables,
    hyperparameters: input.hyperparameters,
    ...(input.lossFunction ? { lossFunction: input.lossFunction } : {}),
    ...(input.trainTestSplit !== undefined
      ? { trainTestSplit: input.trainTestSplit }
      : {}),
    ...(input.selectedMetrics
      ? { selectedMetrics: input.selectedMetrics }
      : {}),
    ...(input.deployment ? { deployment: input.deployment } : {}),
  }
}

/**
 * Target tags from a config, back-compatible with pre-multi-select models that
 * stored a single `targetVariable` string. Single source for reading targets.
 */
export function configTargets(config: ModelConfig | null): string[] {
  if (!config) return []
  if (config.targetVariables && config.targetVariables.length > 0) {
    return config.targetVariables
  }
  return config.targetVariable ? [config.targetVariable] : []
}

/** Read a persisted config off a model, or null when it predates this feature. */
export function readModelConfig(model: AIModel): ModelConfig | null {
  const config = (model.data as { config?: ModelConfig } | null)?.config
  return config ?? null
}
