import { describe, expect, it } from 'vitest'
import type { CanvasNode } from '@/services/canvas'
import type { AIModel } from '@/types'
import {
  abnormalEquipment,
  buildOverviewTree,
  normalizeModelStatus,
} from './overview-tree'

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
      // Both 'error' and 'running' require enabled=true under
      // classifyDeployStatus's own invariant (disabled always reads
      // 'stopped') — every call site here passes one of those two.
      enabled: true,
      prodStatus: 'normal',
      // Required by ModelData. Its absence was a pre-existing tsc error in
      // this fixture (not caught by vitest, which does not type-check).
      editHistory: [],
      logs: [],
    },
    nodesId: opts.nodesId ?? null,
    datasetId: null,
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
    // MODEL-SERVE-024-D02: a failed deploy is Abnormal, so it rolls up as
    // 'alarm' (read "Alert"); it used to roll up as 'warning'.
    expect(out[0]!.status).toBe('alarm')
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

  it('lists only Abnormal (alerting) equipment — warning and offline read Normal', () => {
    // MODEL-SERVE-024-D02. Warning/offline equipment still raises a row on
    // the Alerts page, but it is not Abnormal, so the hover card omits it.
    const out = abnormalEquipment(
      [
        node('n1', 'warning', 'Warn'),
        node('n2', 'alarm', 'Alarm'),
        node('n3', 'offline', 'Off'),
      ],
      [],
    )
    expect(out.map(n => n.status)).toEqual(['alarm'])
  })
})

describe('normalizeModelStatus — a running model is never offline on the map', () => {
  /** A model as the LIST payload actually delivers it. `monitoring.status`
   *  is what `deriveDeployStatuses` was able to conclude, which for most
   *  models is OFF: that payload passes `driftMonitor: false`, and
   *  `residualSdStatus` is UNKNOWN without joined truth pairs. */
  type ModelData = NonNullable<AIModel['data']>
  type Monitoring = NonNullable<ModelData['monitoring']>

  const listModel = (
    deployStatus: ModelData['deployStatus'],
    status: Monitoring['status'],
  ): AIModel => {
    // Built explicitly rather than by spreading `model(...).data`: that
    // field is OPTIONAL on AIModel, so spreading it widens every required
    // key to possibly-absent and the result stops satisfying ModelData.
    const data: ModelData = {
      deployStatus,
      enabled: deployStatus !== 'stopped',
      prodStatus: 'normal',
      editHistory: [],
      logs: [],
      monitoring: { status, reason: null, frozenColumns: [] },
    }
    return { ...model('m-1', 'M1'), data }
  }

  it.each(['OFF', 'UNKNOWN'] as const)(
    'reads a running model with a %s health verdict as normal, not offline',
    verdict => {
      // THE REPORTED BUG. The detail page showed the model running while
      // the asset tree drew it offline — because "no health claim" and
      // "stopped" share one wire value on this side.
      expect(normalizeModelStatus(listModel('running', verdict))).toBe(
        'normal',
      )
    },
  )

  it('treats initializing the same — warming up is not "no live data"', () => {
    expect(normalizeModelStatus(listModel('initializing', 'OFF'))).toBe(
      'normal',
    )
  })

  it('still reads a STOPPED model as offline', () => {
    // The other half of the conflation, and the half that was always right.
    expect(normalizeModelStatus(listModel('stopped', 'OFF'))).toBe('offline')
  })

  it('never lets the new branch swallow a real verdict', () => {
    expect(normalizeModelStatus(listModel('running', 'ALERT'))).toBe('alarm')
    expect(normalizeModelStatus(listModel('running', 'WARN'))).toBe('warning')
    // FROZEN is amber, not offline: `hasMonitoringAlert` raises it on the
    // Alerts page, and 'offline' ranks BELOW normal in worstStatus, so the
    // old mapping made a stuck instrument unable to mark its own equipment
    // abnormal — green map, alerting Alerts page, same model.
    expect(normalizeModelStatus(listModel('running', 'FROZEN'))).toBe(
      'warning',
    )
    // A failed deploy outranks everything, is checked first, and is Abnormal
    // (MODEL-SERVE-024-D02), so it maps to 'alarm'.
    expect(normalizeModelStatus(listModel('error', 'OFF'))).toBe('alarm')
  })
})

describe('monitoringReason reaches the hover card (MODEL-SERVE-012-T13)', () => {
  const alerting = (): AIModel => ({
    ...model('m-9', 'Steam Temp', { nodesId: 'n1' }),
    data: {
      deployStatus: 'running',
      enabled: true,
      prodStatus: 'normal',
      editHistory: [],
      logs: [],
      monitoring: { status: 'ALERT', reason: 'STALE', frozenColumns: [] },
    },
  })

  it('carries the reason code onto the model row', () => {
    const [plant] = buildOverviewTree([], [node('n1', 'normal')], [alerting()])
    const row = plant!.nodes[0]!.models[0]!

    expect(row.status).toBe('alarm')
    expect(row.monitoringReason).toBe('STALE')
  })

  it('is null when the axis made no claim, so nothing renders an empty label', () => {
    const [plant] = buildOverviewTree([], [node('n1', 'normal')], [
      model('m-1', 'M1', { nodesId: 'n1' }),
    ])

    expect(plant!.nodes[0]!.models[0]!.monitoringReason).toBeNull()
  })

  it('surfaces through abnormalEquipment, which is what the hover card reads', () => {
    const out = abnormalEquipment([node('n1', 'normal')], [alerting()])

    expect(out).toHaveLength(1)
    expect(out[0]!.models[0]!.monitoringReason).toBe('STALE')
  })
})

describe('overview parity with the Alerts page (MODEL-SERVE-012-T13, MODEL-SERVE-024)', () => {
  // The two surfaces must agree about the same model. Since MODEL-SERVE-024
  // that means: an ALERT is an Alert row on the Alerts page AND Abnormal
  // equipment here; a WARN/FROZEN is a Warning row there AND Normal here.
  it.each([
    ['ALERT', 'alarm', 1],
    ['WARN', 'warning', 0],
    ['FROZEN', 'warning', 0],
  ] as const)(
    'a %s model maps to %s and makes %i equipment abnormal',
    (status, expected, abnormalRows) => {
      const m: AIModel = {
        ...model('m-1', 'M1', { nodesId: 'n1' }),
        data: {
          deployStatus: 'running',
          enabled: true,
          prodStatus: 'normal',
          editHistory: [],
          logs: [],
          monitoring: { status, reason: null, frozenColumns: [] },
        },
      }

      expect(normalizeModelStatus(m)).toBe(expected)
      // The equipment row the hover card actually renders.
      expect(abnormalEquipment([node('n1', 'normal')], [m])).toHaveLength(
        abnormalRows,
      )
    },
  )

  it.each(['OFF', 'UNKNOWN'] as const)(
    'a %s model does NOT raise — no claim is not a fault',
    status => {
      const m: AIModel = {
        ...model('m-1', 'M1', { nodesId: 'n1' }),
        data: {
          deployStatus: 'running',
          enabled: true,
          prodStatus: 'normal',
          editHistory: [],
          logs: [],
          monitoring: { status, reason: null, frozenColumns: [] },
        },
      }

      expect(abnormalEquipment([node('n1', 'normal')], [m])).toHaveLength(0)
    },
  )
})
