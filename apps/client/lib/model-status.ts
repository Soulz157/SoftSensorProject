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
