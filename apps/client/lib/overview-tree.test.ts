import { describe, expect, it } from 'vitest'
import type { CanvasNode } from '@/services/canvas'
import type { AIModel } from '@/types'
import { abnormalEquipment } from './overview-tree'

function node(
  id: string,
  status: CanvasNode['data']['status'],
  name = id,
): CanvasNode {
  return {
    id,
    workspaceId: 'ws-1',
    planId: 'plan-1',
    data: { name, type: 'sensor', status, x: 0, y: 0 },
    models: [],
    createdAt: '2026-06-29T00:00:00Z',
    updatedAt: '2026-06-29T00:00:00Z',
  }
}

function model(
  id: string,
  name: string,
  opts: {
    nodesId?: string | null
    deployStatus?: 'error' | 'running'
  } = {},
): AIModel {
  return {
    id,
    workspaceId: 'ws-1',
    name,
    data: {
      deployStatus: opts.deployStatus ?? 'running',
      prodStatus: 'normal',
      logs: [],
    },
    nodesId: opts.nodesId ?? null,
    createdAt: '2026-06-29T00:00:00Z',
    updatedAt: '2026-06-29T00:00:00Z',
    nodes: null,
  }
}

describe('abnormalEquipment', () => {
  it('lists an alarm node', () => {
    const out = abnormalEquipment([node('n1', 'alarm', 'Reactor A')], [])
    expect(out).toHaveLength(1)
    expect(out[0]!.name).toBe('Reactor A')
    expect(out[0]!.status).toBe('alarm')
  })

  it('excludes a fully-normal workspace', () => {
    expect(abnormalEquipment([node('n1', 'normal')], [])).toHaveLength(0)
  })

  it('bubbles a failed model into an otherwise-normal node', () => {
    const out = abnormalEquipment(
      [node('n1', 'normal', 'Pump 02')],
      [
        model('m1', 'Vibration Model', {
          nodesId: 'n1',
          deployStatus: 'error',
        }),
      ],
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.name).toBe('Pump 02')
    expect(out[0]!.status).toBe('warning') // failed deploy → warning rollup
    const failed = out[0]!.models.find(m => m.id === 'm1')
    expect(failed?.deployFailed).toBe(true)
  })

  it('surfaces an orphan failed model as a pseudo-equipment row', () => {
    const out = abnormalEquipment(
      [],
      [model('m1', 'Orphan Model', { deployStatus: 'error' })],
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.type).toBe('model')
    expect(out[0]!.models[0]!.deployFailed).toBe(true)
  })

  it('sorts alarm before warning', () => {
    const out = abnormalEquipment(
      [node('n1', 'warning', 'Warn'), node('n2', 'alarm', 'Alarm')],
      [],
    )
    expect(out.map(n => n.status)).toEqual(['alarm', 'warning'])
  })
})
