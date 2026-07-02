import type { CanvasNode } from '@/services/canvas'
import type { AIModel, WorkspacePlant } from '@/types'
import type { NodeStatus } from '@/store/status-colors'
import { NODE_STATUS_PRIORITY } from '@/constants/status'
import {
  effectiveProdStatus,
  failedDeploys,
  isDeployFailed,
} from '@/lib/model-status'

export interface OverviewTreeModel {
  id: string
  name: string
  status: NodeStatus
  deployFailed: boolean
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
  const s = effectiveProdStatus(m)
  if (s === 'alert') return 'alarm'
  // The overview map has no purple state — a frozen model reads as offline
  // (no live data) for rollup purposes.
  if (s === 'frozen') return 'offline'
  return s
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
