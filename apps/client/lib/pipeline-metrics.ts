/**
 * Pure derivations for the Analytics → Data-Integration command center.
 *
 * No React, no IO. Every number is seeded deterministically from a
 * `(scope, range, …)` key so a workspace-filter switch yields distinct but
 * stable values — no flicker across re-renders (same idea as the `hash01`
 * generator in `lib/mock-readings.ts`).
 *
 * This is a *derivation* over the existing approved mocks (`MOCK_PI_TAGS`,
 * `MOCK_PI_SERVERS`) plus the real workspace list — NOT a new mock-data file.
 * The genuinely-arbitrary baseline constants (uptime %, latency ms, batch
 * totals) are inlined here, consistent with the app's current placeholder state.
 */
import { MOCK_PI_TAGS, rangeConfig, type TimeRange } from '@/lib/mock-readings'
import { MOCK_PI_SERVERS } from '@/lib/mock-pi-servers'
import type { NodeStatus } from '@/store/status-colors'
import type { Workspace } from '@/types'

/** `'all'` = every workspace, otherwise a single workspace id. */
export type Scope = 'all' | string

export interface PipelineKpis {
  managedTags: number
  uptimePct: number
  batchesSynced: number
  batchesTotal: number
  /** Records ingested today. */
  throughput: number
  latencyMs: number
}

export interface TagHealth {
  good: number
  stale: number
  bad: number
}

export interface IngestionPoint {
  label: string
  /** Records ingested in the bucket (thousands). */
  volume: number
  /** Batch fetch success rate, %. */
  successRate: number
}

export interface WorkspacePipelineRow {
  id: string
  name: string
  tagsSynced: number
  batchSuccessPct: number
  lastUpdate: string
  status: NodeStatus
}

/** Deterministic hash → [0, 1). Stable for a given string. */
function hash01(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/** Deterministic value in `[min, max]` for a seed. */
function seeded(seed: string, min: number, max: number): number {
  return min + hash01(seed) * (max - min)
}

/** Managed-tag count for one workspace (seeded, ~40–260). */
function tagsForWorkspace(id: string): number {
  return Math.round(seeded(`tags:${id}`, 40, 260))
}

/** Total managed tags in scope: one workspace, or the sum across all. */
function managedTags(scope: Scope, workspaces: Workspace[]): number {
  if (scope !== 'all') return tagsForWorkspace(scope)
  if (workspaces.length === 0) return MOCK_PI_TAGS.length
  return workspaces.reduce((sum, ws) => sum + tagsForWorkspace(ws.id), 0)
}

/** Batch success rate, % (seeded, ~94–99.9). */
function successPct(seed: string): number {
  return Number(seeded(`success:${seed}`, 94, 99.9).toFixed(1))
}

function statusFromSuccess(pct: number): NodeStatus {
  if (pct >= 99) return 'normal'
  if (pct >= 97) return 'warning'
  return 'alarm'
}

/** Top KPI cards for the current scope + range. */
export function pipelineKpis(
  scope: Scope,
  range: TimeRange,
  workspaces: Workspace[],
): PipelineKpis {
  const key = `${scope}:${range}`
  const tags = managedTags(scope, workspaces)

  const batchesTotal = Math.round(seeded(`batches:${key}`, 320, 600))
  const failed = Math.round(seeded(`failed:${key}`, 0, 6))
  const batchesSynced = batchesTotal - failed

  // Throughput scales with managed tags and the window's sample density.
  const { points } = rangeConfig(range)
  const throughput = Math.round(tags * points * seeded(`vol:${key}`, 8, 18))

  return {
    managedTags: tags,
    uptimePct: Number(seeded(`uptime:${key}`, 99.2, 99.99).toFixed(2)),
    batchesSynced,
    batchesTotal,
    throughput,
    latencyMs: Math.round(seeded(`lat:${key}`, 12, 42)),
  }
}

/** Tag-health split (Good/Stale/Bad) whose counts sum to managed tags. */
export function tagHealthBreakdown(
  scope: Scope,
  workspaces: Workspace[],
): TagHealth {
  const total = managedTags(scope, workspaces)
  const badFrac = seeded(`badfrac:${scope}`, 0.02, 0.08)
  const staleFrac = seeded(`stalefrac:${scope}`, 0.05, 0.14)
  const bad = Math.round(total * badFrac)
  const stale = Math.round(total * staleFrac)
  const good = Math.max(0, total - bad - stale)
  return { good, stale, bad }
}

/** Ingestion volume + batch success-rate series across the selected window. */
export function ingestionTrendSeries(
  scope: Scope,
  range: TimeRange,
): IngestionPoint[] {
  const { points, stepMs, tickFormat } = rangeConfig(range)
  const now = Date.now()
  const series: IngestionPoint[] = []
  for (let i = points - 1; i >= 0; i--) {
    const ts = now - i * stepMs
    const iso = new Date(ts).toISOString()
    const seed = `${scope}:${ts}`
    series.push({
      label: tickFormat(iso),
      volume: Number(seeded(`tvol:${seed}`, 40, 120).toFixed(1)),
      successRate: successPct(seed),
    })
  }
  return series
}

/** One pipeline row per real workspace for the "Pipeline by Workspace" table. */
export function perWorkspacePipeline(
  workspaces: Workspace[],
): WorkspacePipelineRow[] {
  const server = MOCK_PI_SERVERS[0]
  return workspaces.map(ws => {
    const pct = successPct(ws.id)
    const minsAgo = Math.round(seeded(`upd:${ws.id}`, 1, 40))
    return {
      id: ws.id,
      name: ws.name,
      tagsSynced: tagsForWorkspace(ws.id),
      batchSuccessPct: pct,
      lastUpdate: `${minsAgo}m ago`,
      status: server?.status === 'offline' ? 'offline' : statusFromSuccess(pct),
    }
  })
}
