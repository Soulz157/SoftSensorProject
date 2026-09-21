import { describe, expect, it } from 'vitest'
import type { AIModel } from '@/types'
import {
  failedCountByNodeId,
  monitoringCountByNodeId,
  monitoringStatus,
} from './model-status'

type Monitoring = NonNullable<NonNullable<AIModel['data']>['monitoring']>

function model(
  id: string,
  opts: {
    nodesId?: string | null
    deployStatus?: 'error' | 'running' | 'stopped'
    monitoring?: Monitoring
  } = {},
): AIModel {
  return {
    id,
    workspaceId: 'ws-1',
    name: id,
    data: {
      deployStatus: opts.deployStatus ?? 'running',
      enabled: true,
      // The hand-set column. Left at 'normal' everywhere on purpose: these
      // tests assert that it no longer decides anything.
      prodStatus: 'normal',
      logs: [],
      editHistory: [],
      ...(opts.monitoring ? { monitoring: opts.monitoring } : {}),
    },
    nodesId: opts.nodesId ?? null,
    datasetId: null,
    createdAt: '2026-06-29T00:00:00Z',
    updatedAt: '2026-06-29T00:00:00Z',
    nodes: null,
  } as AIModel
}

const alerting: Monitoring = {
  status: 'ALERT',
  reason: 'RESIDUAL_SD_CRITICAL',
  frozenColumns: [],
}

describe('monitoringStatus (MODEL-SERVE-012)', () => {
  it('reports the MEASURED verdict, not the hand-set prodStatus', () => {
    // prodStatus is 'normal' on every fixture here. Before the badges merged
    // this model rendered "Normal" beside a health pill reading "Alert".
    expect(monitoringStatus(model('m1', { monitoring: alerting }))).toBe(
      'alert',
    )
  })

  it('maps UNKNOWN to offline, never normal — no reading is not health', () => {
    expect(
      monitoringStatus(
        model('m1', {
          monitoring: { status: 'UNKNOWN', reason: null, frozenColumns: [] },
        }),
      ),
    ).toBe('offline')
  })

  it('reads offline whatever the axis says once the model is off infra', () => {
    expect(
      monitoringStatus(
        model('m1', { deployStatus: 'stopped', monitoring: alerting }),
      ),
    ).toBe('offline')
  })
})

/**
 * MODEL-SERVE-012. THE OVERVIEW-TOWER DOT BUG, as a regression test.
 *
 * The tower's per-node dots were fed by `failedCountByNodeId` alone, so a
 * model alerting on the MONITORING axis left its node green while the same
 * model raised a row on the Alerts page. The workspace-level figure had both
 * rollups; the node level had only one.
 */
describe('monitoringCountByNodeId', () => {
  it('counts a monitoring alert that the DEPLOY rollup cannot see', () => {
    const models = [
      model('m1', { nodesId: 'node-a', monitoring: alerting }),
    ]

    // The deploy axis is clean — this model is running, not failed.
    expect(failedCountByNodeId(models)).toEqual({})
    // ...and that is exactly why the dot stayed green before this existed.
    expect(monitoringCountByNodeId(models)).toEqual({ 'node-a': 1 })
  })

  it('sums several alerting models on one node', () => {
    expect(
      monitoringCountByNodeId([
        model('m1', { nodesId: 'node-a', monitoring: alerting }),
        model('m2', { nodesId: 'node-a', monitoring: alerting }),
        model('m3', { nodesId: 'node-b', monitoring: alerting }),
      ]),
    ).toEqual({ 'node-a': 2, 'node-b': 1 })
  })

  it('omits a model with no node — it has no dot to colour', () => {
    expect(
      monitoringCountByNodeId([model('m1', { monitoring: alerting })]),
    ).toEqual({})
  })

  it('does NOT count OFF or UNKNOWN — no claim is not a fault', () => {
    expect(
      monitoringCountByNodeId([
        model('m1', {
          nodesId: 'node-a',
          monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
        }),
        model('m2', {
          nodesId: 'node-a',
          monitoring: { status: 'UNKNOWN', reason: null, frozenColumns: [] },
        }),
      ]),
    ).toEqual({})
  })
})
