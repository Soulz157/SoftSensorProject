import type { AIModel } from '@/types'

export type EffectiveProdStatus =
  | 'normal'
  | 'warning'
  | 'alert'
  | 'offline'
  | 'frozen'

// Monitoring state is meaningless when the model isn't running on infra —
// a stopped or failed deployment always reads as offline. A running model whose
// data has frozen (sensor offline / missing data) reports 'frozen'.
export function effectiveProdStatus(m: AIModel): EffectiveProdStatus {
  const deploy = m.data?.deployStatus ?? 'stopped'
  if (deploy === 'stopped' || deploy === 'error') return 'offline'
  return m.data?.prodStatus ?? 'offline'
}

/**
 * Single source of truth for failed-deploy detection (wire value: 'error').
 * Use this predicate everywhere — never inline `m.data?.deployStatus === 'error'`.
 */
export function isDeployFailed(m: AIModel): boolean {
  return m.data?.deployStatus === 'error'
}

/**
 * Models whose deployment failed (`deployStatus === 'error'`, UI label "Failed").
 * Single source of truth for failed-deploy detection — used by the Alerts page
 * and the Overview detail panel. Do not inline the filter in components.
 */
export function failedDeploys<T extends AIModel>(models: T[]): T[] {
  return models.filter(isDeployFailed)
}

/**
 * Count of failed deploys per `workspaceId`. Lets workspace indicators (sidebar
 * dot, cards, admin list) fold model failures into their status without each
 * re-implementing the filter.
 */
export function failedCountByWorkspace(
  models: AIModel[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of failedDeploys(models)) {
    out[m.workspaceId] = (out[m.workspaceId] ?? 0) + 1
  }
  return out
}

/**
 * Count of failed deploys per `nodesId`. Lets the tower equipment-dots fold
 * model failures into the node's visual status without re-filtering models.
 * Nodes with no failed models are absent from the result (treat as 0).
 */
export function failedCountByNodeId(models: AIModel[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of failedDeploys(models)) {
    if (!m.nodesId) continue
    out[m.nodesId] = (out[m.nodesId] ?? 0) + 1
  }
  return out
}

export type DeployStatus = 'running' | 'initializing' | 'stopped' | 'error'
export type DeployCounts = Record<DeployStatus, number>

export function deployCounts(models: AIModel[]): DeployCounts {
  return {
    running: models.filter(m => m.data?.deployStatus === 'running').length,
    initializing: models.filter(m => m.data?.deployStatus === 'initializing')
      .length,
    stopped: models.filter(
      m => (m.data?.deployStatus ?? 'stopped') === 'stopped',
    ).length,
    error: models.filter(m => m.data?.deployStatus === 'error').length,
  }
}

export type DeployVerdict =
  | { kind: 'failed'; count: number }
  | { kind: 'initializing'; count: number }
  | { kind: 'stopped'; count: number }
  | { kind: 'all-running'; count: number }
  | { kind: 'empty' }

export function deployVerdict(models: AIModel[]): DeployVerdict {
  if (models.length === 0) return { kind: 'empty' }
  const counts = deployCounts(models)
  if (counts.error > 0) return { kind: 'failed', count: counts.error }
  if (counts.initializing > 0)
    return { kind: 'initializing', count: counts.initializing }
  if (counts.stopped > 0) return { kind: 'stopped', count: counts.stopped }
  return { kind: 'all-running', count: counts.running }
}
