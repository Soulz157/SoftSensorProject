import type { CanvasNode } from '@/services/canvas'
import type { AIModel, WorkspacePlant } from '@/types'
import type { NodeStatus } from '@/store/status-colors'
import type { HealthReason } from '@/lib/health-status-style'
import { NODE_STATUS_PRIORITY } from '@/constants/status'
import {
  monitoringStatus,
  failedDeploys,
  isDeployFailed,
} from '@/lib/model-status'

export interface OverviewTreeModel {
  id: string
  name: string
  status: NodeStatus
  deployFailed: boolean
  /**
   * The monitoring axis's own reason code, when it has one — the WHY behind
   * a non-normal status, carried so the hover card can name the fault
   * instead of showing a coloured dot and leaving the operator to open the
   * model to find out. Null whenever the axis made no claim (`OFF`,
   * `UNKNOWN`, or a payload predating MODEL-SERVE-001-T26), which is also
   * every model this map now renders as normal.
   */
  monitoringReason: HealthReason | null
}

export interface OverviewTreeNode {
  id: string
  name: string
  type: string
  status: NodeStatus
  models: OverviewTreeModel[]
}

export interface OverviewTreePlant {
  id: string
  name: string
  status: NodeStatus
  nodes: OverviewTreeNode[]
}

const UNASSIGNED_ID = '__unassigned__'

// Map a model's effective production status onto the canonical NodeStatus scale
// used by every tree row. A failed deploy is treated as 'warning' so it beats
// 'normal' in worstStatus and the red trail bubbles up to Equipment and Plant.
// (NODE_STATUS_PRIORITY: offline=3 > normal=2, so offline never beats normal.)
export function normalizeModelStatus(m: AIModel): NodeStatus {
  if (isDeployFailed(m)) return 'warning'
  const s = monitoringStatus(m)
  if (s === 'alert') return 'alarm'
  // A FROZEN MODEL IS ABNORMAL, NOT ABSENT.
  //
  // This used to return 'offline' ("the overview map has no purple state"),
  // and the choice of substitute quietly decided whether anyone would ever
  // see it: `worstStatus` ranks offline (3) BELOW normal (2), so a frozen
  // model could not lift its equipment out of normal, `abnormalEquipment`
  // filters on exactly that, and the hover card reads `abnormalEquipment`.
  // A stuck instrument therefore raised a row on the Alerts page — which
  // treats FROZEN as an alert via `hasMonitoringAlert` — while the overview
  // stayed green about the same model. Two surfaces, one fact, opposite
  // answers.
  //
  // 'warning' is the honest substitute: a frozen tag is a real fault the
  // operator must act on, and it is less severe than an ALERT, which is
  // precisely what amber means here. The map still has no purple; what it
  // no longer has is a fault that hides in the one rank nothing escalates
  // out of.
  if (s === 'frozen') return 'warning'
  // A RUNNING MODEL IS NEVER OFFLINE ON THIS MAP.
  //
  // `monitoringStatus` collapses two unrelated facts into 'offline': the
  // model is STOPPED, and the model is running but the health axis made NO
  // CLAIM. The second is the common case rather than an edge — the list
  // payload passes `driftMonitor: false`, and `residualSdStatus` is UNKNOWN
  // for any model with no joined truth pairs, so `classifyModelHealth`
  // reaches OFF and never OK (see `monitoringStatus`'s own doc comment,
  // which states this outright).
  //
  // On a pill, 'offline' meaning "no claim" is survivable. On this map it is
  // not: a dot labelled offline beside a model the operator can see running
  // asserts the plant is down. 'normal' is the honest rendering of "it is up
  // and nothing has been reported against it" — and it smuggles in no health
  // claim, because a real WARN/ALERT from any axis is handled above and
  // still bubbles up through `worstStatus`.
  if (s === 'offline' && isDeployLive(m)) return 'normal'
  return s
}

/** Up, as far as the DEPLOY axis is concerned. `initializing` counts: the
 *  schedule is on and warming up, which is not "no live data" either. */
function isDeployLive(m: AIModel): boolean {
  const deploy = m.data?.deployStatus
  return deploy === 'running' || deploy === 'initializing'
}

// Worst (most severe) status wins — lower NODE_STATUS_PRIORITY is more severe.
// Lets an alarm at any descendant bubble up to its parent row.
export function worstStatus(statuses: NodeStatus[]): NodeStatus {
  return statuses.reduce<NodeStatus>(
    (worst, s) =>
      (NODE_STATUS_PRIORITY[s] ?? 3) < (NODE_STATUS_PRIORITY[worst] ?? 3)
        ? s
        : worst,
    'normal',
  )
}

// Build the Plant → Equipment → Model tree for a single workspace.
// Nodes with no matching plant and models with no node are collected under a
// synthetic "Unassigned" plant so nothing is hidden versus the old flat lists.
export function buildOverviewTree(
  plants: WorkspacePlant[],
  nodes: CanvasNode[],
  models: AIModel[],
): OverviewTreePlant[] {
  const modelsByNodeId = new Map<string, AIModel[]>()
  const unassignedModels: AIModel[] = []
  for (const m of models) {
    if (m.nodesId) {
      const arr = modelsByNodeId.get(m.nodesId) ?? []
      arr.push(m)
      modelsByNodeId.set(m.nodesId, arr)
    } else {
      unassignedModels.push(m)
    }
  }

  const plantIds = new Set(plants.map(p => p.id))

  const buildNode = (n: CanvasNode): OverviewTreeNode => {
    const treeModels: OverviewTreeModel[] = (
      modelsByNodeId.get(n.id) ?? []
    ).map(m => ({
      id: m.id,
      name: m.name,
      status: normalizeModelStatus(m),
      deployFailed: isDeployFailed(m),
      monitoringReason: m.data?.monitoring?.reason ?? null,
    }))
    const ownStatus = (n.data.status ?? 'normal') as NodeStatus
    return {
      id: n.id,
      name: n.data.name,
      type: n.data.type,
      status: worstStatus([ownStatus, ...treeModels.map(m => m.status)]),
      models: treeModels,
    }
  }

  const result: OverviewTreePlant[] = plants.map(plant => {
    const treeNodes = nodes.filter(n => n.planId === plant.id).map(buildNode)
    return {
      id: plant.id,
      name: plant.name,
      status: worstStatus(treeNodes.map(n => n.status)),
      nodes: treeNodes,
    }
  })

  // Orphaned nodes (no matching plant) + models with no node.
  const orphanNodes = nodes.filter(n => !plantIds.has(n.planId)).map(buildNode)
  const orphanModelRows: OverviewTreeModel[] = unassignedModels.map(m => ({
    id: m.id,
    name: m.name,
    status: normalizeModelStatus(m),
    deployFailed: isDeployFailed(m),
    monitoringReason: m.data?.monitoring?.reason ?? null,
  }))

  if (orphanNodes.length > 0 || orphanModelRows.length > 0) {
    // Surface unattached models as a pseudo-equipment row so they remain visible.
    const extraNodes = [...orphanNodes]
    if (orphanModelRows.length > 0) {
      extraNodes.push({
        id: `${UNASSIGNED_ID}__models`,
        name: 'Unassigned models',
        type: 'model',
        status: worstStatus(orphanModelRows.map(m => m.status)),
        models: orphanModelRows,
      })
    }
    result.push({
      id: UNASSIGNED_ID,
      name: 'Unassigned',
      status: worstStatus(extraNodes.map(n => n.status)),
      nodes: extraNodes,
    })
  }

  return result
}

/**
 * Flattened, severity-sorted abnormal equipment for a single workspace — each
 * node's status is rolled up over its models (a failed/abnormal model bubbles up
 * via `buildOverviewTree`). Plant grouping is intentionally dropped (pass
 * `plants = []`) so every node is collected; orphan failed models surface as the
 * synthetic "Unassigned models" row. Drives the overview map hover card.
 */
export function abnormalEquipment(
  nodes: CanvasNode[],
  models: AIModel[],
): OverviewTreeNode[] {
  return buildOverviewTree([], nodes, models)
    .flatMap(p => p.nodes)
    .filter(n => n.status !== 'normal')
    .sort(
      (a, b) =>
        (NODE_STATUS_PRIORITY[a.status] ?? 3) -
        (NODE_STATUS_PRIORITY[b.status] ?? 3),
    )
}

export interface FailedModelPath {
  modelId: string
  modelName: string
  equipmentName: string | null
  equipmentId: string | null
  plantName: string | null
  plantId: string | null
}

// Resolve each failed model to its full Plant → Equipment path for the
// troubleshooting panel. Pure derivation — no I/O.
export function failedModelPaths(
  plants: WorkspacePlant[],
  nodes: CanvasNode[],
  models: AIModel[],
): FailedModelPath[] {
  return failedDeploys(models).map(m => {
    const node = nodes.find(n => n.id === m.nodesId) ?? null
    const plant = node ? (plants.find(p => p.id === node.planId) ?? null) : null
    return {
      modelId: m.id,
      modelName: m.name,
      equipmentId: node?.id ?? null,
      equipmentName: node?.data.name ?? null,
      plantId: plant?.id ?? null,
      plantName: plant?.name ?? null,
    }
  })
}
