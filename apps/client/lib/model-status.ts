import type { AIModel } from '@/types'

export type EffectiveProdStatus =
  | 'normal'
  | 'warning'
  | 'alert'
  | 'offline'
  | 'frozen'

/**
 * MODEL-SERVE-012. THE ONE MONITORING VERDICT, replacing the pair of badges
 * that used to sit side by side on the model header.
 *
 * WHY THEY MERGED. The `effectiveProdStatus` this replaced (deleted in
 * MODEL-SERVE-012-T09) read `data.prodStatus`, a STORED column an operator
 * set by hand and which defaults to 'normal'.
 * Nothing kept it honest: a model could show "Normal" beside a Health pill
 * reading "Alert", on the same header, about the same model — two
 * contradictory verdicts in one view, the defect this codebase has had to
 * repair more than once. The health axis is MEASURED, so it wins, and the
 * manual field stops driving the badge.
 *
 * The vocabulary is unchanged (`EffectiveProdStatus`), so every existing
 * reader of these five words keeps working.
 *
 * INFRA FIRST, kept verbatim from the deleted `effectiveProdStatus`:
 * monitoring state is
 * meaningless when the model is not running on infra, so a stopped or failed
 * deployment reads offline whatever the health axis last said.
 *
 * UNKNOWN MAPS TO OFFLINE, NEVER NORMAL. "We have no reading" and "the model
 * is fine" are different claims, and a green badge for the first is exactly
 * how a monitoring surface goes quietly blind — the same asymmetry
 * `hasMonitoringAlert` below already documents for the list payload.
 */
export function monitoringStatusFromHealth(
  health: MonitoringHealthStatus | undefined,
  deploy: string | undefined,
): EffectiveProdStatus {
  if (deploy === undefined || deploy === 'stopped' || deploy === 'error')
    return 'offline'

  switch (health) {
    case 'FROZEN':
      return 'frozen'
    case 'ALERT':
    case 'CRITICAL':
      return 'alert'
    case 'WARN':
      return 'warning'
    case 'OK':
      return 'normal'
    // OFF, UNKNOWN, and an absent payload all mean "no claim".
    default:
      return 'offline'
  }
}

/** The health axis's own status vocabulary, off the wire. */
type MonitoringHealthStatus = NonNullable<
  NonNullable<NonNullable<AIModel['data']>['monitoring']>['status']
>

/**
 * The same verdict for a model from the LIST payload.
 *
 * READ THE WARNING BEFORE USING THIS ON A NEW SURFACE. `data.monitoring` is
 * built by `deriveDeployStatuses`, which deliberately carries LIVENESS ONLY:
 * it passes `driftMonitor: false`, `missingPct: null`, `frozenColumns: []`
 * and `residualSdStatus: 'UNKNOWN'`, so the classifier can only reach OFF or
 * an ALERT from a fetch fault. It can NEVER emit OK, WARN or FROZEN — which
 * means this function returns 'offline' for a perfectly healthy running
 * model until that payload is widened (MODEL-SERVE-012-T08).
 *
 * The DETAIL page must therefore call `monitoringStatusFromHealth` with
 * `inferenceStatus.health.status` instead — the rich source, and the same
 * one its reason code comes from. Mixing the two produces a pill reading
 * "Offline · residual 1-2SD": a running model badged offline, carrying a
 * reason, which is the exact contradiction merging the badges was meant to
 * remove.
 */
export function monitoringStatus(m: AIModel): EffectiveProdStatus {
  return monitoringStatusFromHealth(
    m.data?.monitoring?.status,
    m.data?.deployStatus ?? 'stopped',
  )
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

/**
 * MODEL-SERVE-001-T30. THE MONITORING AXIS, deliberately separate from
 * `isDeployFailed` above rather than folded into it.
 *
 * Since T26 these answer two different questions. `isDeployFailed` means "the
 * schedule is not dispatching" (wire value 'error', label "Failed"); this
 * means "it IS dispatching, and what comes back is wrong". Three consecutive
 * FAILED windows stopped producing `deployStatus === 'error'` in T26 — they
 * now land here — which is precisely why the Alerts page went quiet for that
 * failure class until this predicate existed.
 *
 * `WARN` and `FROZEN` cannot reach a LIST payload today: `deriveDeployStatuses`
 * hardcodes `missingPct: null` and `frozenColumns: []`
 * (apps/backend/src/lib/deploy-status.ts:318-346). They are matched anyway so
 * that widening the payload later needs no edit here — and so that a reader
 * does not infer from a narrow predicate that those states are not alerts.
 *
 * `OFF`/`UNKNOWN` are NOT alerts, and that asymmetry is load-bearing: on the
 * list path `OFF` means "no fault, no claim", never "healthy". Raising a row
 * for it would alert on every unmonitored model in the workspace.
 */
export function hasMonitoringAlert(m: AIModel): boolean {
  const status = m.data?.monitoring?.status
  return status === 'ALERT' || status === 'WARN' || status === 'FROZEN'
}

/**
 * MODEL-SERVE-012. Count of MONITORING-axis alerts per `nodesId` — the twin
 * of `failedCountByNodeId` above, and the one that was missing.
 *
 * WHY IT IS A BUG THAT THIS DID NOT EXIST. The workspace level had both
 * rollups (`failedCountByWorkspace` + `monitoringCountByWorkspace`) and the
 * Overview map folded both into its per-workspace figure. The NODE level had
 * only the deploy one, so a model raising on the monitoring axis — a dead
 * source, bad data, a frozen tag, a widened residual spread — never reached
 * the per-node dots on the tower name badge. They stayed green while the
 * model was alerting, and nothing in the rollup was wrong enough to notice:
 * the deploy half worked, so the map looked live.
 *
 * Models with no `nodesId` are absent, same as the deploy twin: a model not
 * placed on a node has no dot to colour.
 */
export function monitoringCountByNodeId(
  models: AIModel[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of monitoringAlerts(models)) {
    if (!m.nodesId) continue
    out[m.nodesId] = (out[m.nodesId] ?? 0) + 1
  }
  return out
}

/** Models whose MONITORING axis is raising. Mirrors `failedDeploys`'s shape so
 *  the Alerts page treats the two axes the same way. */
export function monitoringAlerts<T extends AIModel>(models: T[]): T[] {
  return models.filter(hasMonitoringAlert)
}

/**
 * Count of monitoring alerts per `workspaceId`, the monitoring-axis twin of
 * `failedCountByWorkspace`. Kept separate rather than summed into it: the
 * sidebar dot and the workspace card each decide their own severity, and a
 * caller that wants the total can add them.
 */
export function monitoringCountByWorkspace(
  models: AIModel[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of monitoringAlerts(models)) {
    out[m.workspaceId] = (out[m.workspaceId] ?? 0) + 1
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
