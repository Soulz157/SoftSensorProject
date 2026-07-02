import { describe, expect, it } from 'vitest'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace, WorkspacePlant } from '@/types'
import type { ModelWithWorkspace } from '@/hooks/use-all-models'
import {
  buildAlerts,
  filterAlerts,
  formatLocation,
  sortAlerts,
  EMPTY_FILTERS,
} from './alerts'

const WS_ID = 'ws-1'
const PLANT_A = 'plant-a'
const PLANT_B = 'plant-b'

function workspace(): Workspace {
  return {
    id: WS_ID,
    ownerId: 'owner-1',
    name: 'Repco',
    createdAt: '2026-06-29T00:00:00Z',
    updatedAt: '2026-06-29T00:00:00Z',
    _count: { members: 1, models: 2 },
    modelsCount: 2,
  }
}

function plant(id: string, name: string): WorkspacePlant {
  return {
    id,
    workspaceId: WS_ID,
    name,
    createdAt: '2026-06-29T00:00:00Z',
    updatedAt: '2026-06-29T00:00:00Z',
  }
}

function node(
  id: string,
  planId: string,
  data: Partial<CanvasNode['data']> & {
    status: CanvasNode['data']['status']
    name: string
  },
): CanvasNode {
  return {
    id,
    workspaceId: WS_ID,
    planId,
    data: { type: 'sensor', x: 0, y: 0, ...data },
    models: [],
    createdAt: '2026-06-29T00:00:00Z',
    updatedAt: '2026-06-29T00:00:00Z',
  }
}

function failedModel(
  id: string,
  name: string,
  opts: { node?: { name: string; planId: string; planName?: string } } = {},
): ModelWithWorkspace {
  return {
    id,
    workspaceId: WS_ID,
    name,
    workspaceName: 'Repco',
    data: {
      deployStatus: 'error',
      prodStatus: 'offline',
      statusDetail: 'R-squared dropped below 0.8',
      logs: [
        {
          level: 'error',
          message: 'connection timeout to PI database',
          timestamp: '2026-06-29T10:00:00Z',
        },
      ],
    },
    nodesId: opts.node ? `node-${id}` : null,
    createdAt: '2026-06-29T00:00:00Z',
    updatedAt: '2026-06-29T00:00:00Z',
    nodes: opts.node
      ? {
          id: `node-${id}`,
          data: { name: opts.node.name },
          planId: opts.node.planId,
          plan: opts.node.planName
            ? { id: opts.node.planId, name: opts.node.planName }
            : null,
        }
      : null,
  }
}

describe('buildAlerts', () => {
  const base = {
    workspaces: [workspace()],
    plantsByWorkspaceId: {
      [WS_ID]: [plant(PLANT_A, 'Plant 1'), plant(PLANT_B, 'Plant 2')],
    },
  }

  it('includes only non-normal nodes + failed models', () => {
    const rows = buildAlerts({
      ...base,
      nodesByWorkspaceId: {
        [WS_ID]: [
          node('n1', PLANT_A, { status: 'alarm', name: 'Reactor A' }),
          node('n2', PLANT_B, { status: 'normal', name: 'Healthy Pump' }),
          node('n3', PLANT_B, {
            status: 'offline',
            name: 'Conveyor 3',
            type: 'machine',
          }),
        ],
      },
      models: [failedModel('m1', 'Temp Predictor V1')],
    })

    // 2 abnormal nodes + 1 failed model; normal node excluded.
    expect(rows).toHaveLength(3)
    expect(rows.some(r => r.equipmentName === 'Healthy Pump')).toBe(false)
  })

  it('resolves plant into Location for node rows', () => {
    const [row] = buildAlerts({
      ...base,
      nodesByWorkspaceId: {
        [WS_ID]: [node('n1', PLANT_A, { status: 'alarm', name: 'Reactor A' })],
      },
      models: [],
    })
    expect(row!.plantName).toBe('Plant 1')
    expect(formatLocation(row!)).toBe('Repco > Plant 1')
    expect(row!.typeLabel).toBe('Sensor Alarm')
    expect(row!.modelName).toBeNull()
    expect(row!.detailError).toBeNull()
  })

  it('handles a failed model linked to equipment (plant + detail)', () => {
    const [row] = buildAlerts({
      ...base,
      nodesByWorkspaceId: { [WS_ID]: [] },
      models: [
        failedModel('m1', 'Vibration Model', {
          node: { name: 'Pump 02', planId: PLANT_B, planName: 'Plant 2' },
        }),
      ],
    })
    expect(row!.kind).toBe('model')
    expect(row!.equipmentName).toBe('Pump 02')
    expect(row!.modelName).toBe('Vibration Model')
    expect(formatLocation(row!)).toBe('Repco > Plant 2')
    expect(row!.typeLabel).toBe('Deploy Failed')
    expect(row!.detailError).toBe('R-squared dropped below 0.8')
    expect(row!.errorLogs).toHaveLength(1)
  })

  it('handles an unlinked failed model (no equipment)', () => {
    const [row] = buildAlerts({
      ...base,
      nodesByWorkspaceId: { [WS_ID]: [] },
      models: [failedModel('m2', 'Orphan Model')],
    })
    expect(row!.equipmentName).toBeNull()
    expect(row!.modelName).toBe('Orphan Model')
    expect(row!.affectedNode).toBeUndefined()
  })

  it('resolves plant from the workspace plant map when the join omits plan name', () => {
    const [row] = buildAlerts({
      ...base,
      nodesByWorkspaceId: { [WS_ID]: [] },
      models: [
        failedModel('m1', 'Model X', {
          node: { name: 'Pump 02', planId: PLANT_A }, // no planName on join
        }),
      ],
    })
    expect(row!.plantName).toBe('Plant 1')
  })

  it('default-sorts by severity: failed first', () => {
    const rows = buildAlerts({
      ...base,
      nodesByWorkspaceId: {
        [WS_ID]: [
          node('n1', PLANT_A, { status: 'warning', name: 'Warn Node' }),
          node('n2', PLANT_A, { status: 'alarm', name: 'Alarm Node' }),
        ],
      },
      models: [failedModel('m1', 'Failed Model')],
    })
    expect(rows.map(r => r.status)).toEqual(['failed', 'alarm', 'warning'])
  })
})

describe('sortAlerts + filterAlerts', () => {
  const rows = buildAlerts({
    workspaces: [workspace()],
    plantsByWorkspaceId: { [WS_ID]: [plant(PLANT_A, 'Plant 1')] },
    nodesByWorkspaceId: {
      [WS_ID]: [
        node('n1', PLANT_A, { status: 'alarm', name: 'Reactor A' }),
        node('n2', PLANT_A, { status: 'warning', name: 'Mixer B' }),
      ],
    },
    models: [failedModel('m1', 'Temp Predictor V1')],
  })

  it('sorts by location ascending', () => {
    const sorted = sortAlerts(rows, 'location', 'asc')
    expect(sorted.every(r => formatLocation(r))).toBeTruthy()
    expect(sorted).toHaveLength(3)
  })

  it('filters by status', () => {
    const out = filterAlerts(rows, { ...EMPTY_FILTERS, status: 'failed' })
    expect(out).toHaveLength(1)
    expect(out[0]!.modelName).toBe('Temp Predictor V1')
  })

  it('filters by free-text over equipment + model name', () => {
    const out = filterAlerts(rows, { ...EMPTY_FILTERS, search: 'reactor' })
    expect(out).toHaveLength(1)
    expect(out[0]!.equipmentName).toBe('Reactor A')
  })

  it('returns all rows with empty filters', () => {
    expect(filterAlerts(rows, EMPTY_FILTERS)).toHaveLength(3)
  })
})
