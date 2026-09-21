import { describe, expect, it } from 'vitest'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace, WorkspacePlant } from '@/types'
import type { ModelWithWorkspace } from '@/hooks/use-all-models'
import {
  buildAlerts,
  filterAlerts,
  formatLocation,
  locationBreadcrumb,
  groupByWorkspace,
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
    status: 'normal',
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
      // classifyDeployStatus never returns 'error' for a disabled schedule
      // (disabled always reads 'stopped') — true is the only value
      // consistent with this fixture's own deployStatus.
      enabled: true,
      prodStatus: 'offline',
      statusDetail: 'R-squared dropped below 0.8',
      // MODEL-SERVE-001-T23. The REAL source. This fixture used to carry a
      // hand-written `logs: [{ level: 'error', ... }]` entry, which made the
      // old assertion pass against data production never produces — every
      // appendModelLog call site in the client hardcodes `level: 'info'`.
      lastFailure: {
        reason: 'connection timeout to PI database',
        at: '2026-06-29T10:00:00Z',
      },
      editHistory: [],
      logs: [],
    },
    nodesId: opts.node ? `node-${id}` : null,
    datasetId: null,
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

/**
 * MODEL-SERVE-001-T30. A model that is DISPATCHING FINE by the deploy axis
 * but whose monitoring axis is raising. Since T26 this is what three
 * consecutive failed windows look like — `deployStatus` stays 'running'.
 */
function monitoringModel(
  id: string,
  name: string,
  monitoring: NonNullable<
    NonNullable<ModelWithWorkspace['data']>['monitoring']
  >,
  over: { deployStatus?: 'running' | 'error' } = {},
): ModelWithWorkspace {
  return {
    id,
    workspaceId: WS_ID,
    name,
    workspaceName: 'Repco',
    data: {
      deployStatus: over.deployStatus ?? 'running',
      enabled: true,
      prodStatus: 'normal',
      lastFailure:
        over.deployStatus === 'error'
          ? { reason: 'preflight refused', at: '2026-06-29T10:00:00Z' }
          : null,
      monitoring,
      editHistory: [],
      logs: [],
    },
    nodesId: null,
    datasetId: null,
    createdAt: '2026-06-29T00:00:00Z',
    updatedAt: '2026-06-29T12:00:00Z',
    nodes: null,
  }
}

describe('buildAlerts — the monitoring axis (MODEL-SERVE-001-T30/V22)', () => {
  const base = {
    workspaces: [workspace()],
    plantsByWorkspaceId: {
      [WS_ID]: [plant(PLANT_A, 'Plant 1'), plant(PLANT_B, 'Plant 2')],
    },
    nodesByWorkspaceId: { [WS_ID]: [] },
  }

  /**
   * THE REGRESSION CASE. Before T30 this model produced NO row at all:
   * `buildAlerts` saw models only through `failedDeploys`, which keys on
   * `deployStatus === 'error'`, and T26 stopped three failed windows from
   * setting that. A dead source was visible on the model detail page and
   * nowhere else in the product.
   */
  it('raises a row for a model whose SOURCE IS DEAD but whose deploy axis reads running', () => {
    const rows = buildAlerts({
      ...base,
      models: [
        monitoringModel('m-dead', 'Furnace Predictor', {
          status: 'ALERT',
          reason: 'SOURCE_UNREACHABLE',
          frozenColumns: [],
        }),
      ],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('monitoring')
    // The reason is CARRIED, not inferred: SOURCE_UNREACHABLE sends a reader
    // to the connector, STALE to the scheduler. A row reading only
    // "Monitoring Alert" would send them to both.
    expect(rows[0]!.monitoringReason).toBe('SOURCE_UNREACHABLE')
    // It must NOT borrow the deploy vocabulary.
    expect(rows[0]!.status).not.toBe('failed')
    expect(rows[0]!.failureReason).toBeNull()
  })

  /**
   * MODEL-SERVE-012. The OUTPUT-ERROR codes reach this page with no wiring
   * of their own — `monitoringReason` is filled from `monitoring.reason` and
   * rendered through the shared `HEALTH_REASON_LABEL`. This test exists to
   * keep that true: a future predicate that whitelisted reason codes, rather
   * than statuses, would silence these two without failing anything else.
   */
  it('raises a row for a WIDENED RESIDUAL SPREAD, carrying its own reason', () => {
    const rows = buildAlerts({
      ...base,
      models: [
        monitoringModel('m-residual', 'Drifting Error', {
          status: 'WARN',
          reason: 'RESIDUAL_SD_WARN',
          frozenColumns: [],
        }),
      ],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('monitoring')
    expect(rows[0]!.monitoringReason).toBe('RESIDUAL_SD_WARN')
    // The model is DISPATCHING fine — this is not the deploy axis.
    expect(rows[0]!.status).not.toBe('failed')
    expect(rows[0]!.failureReason).toBeNull()
  })

  it('carries the 3SD breach distinctly from the 1-2SD warning', () => {
    const rows = buildAlerts({
      ...base,
      models: [
        monitoringModel('m-residual-bad', 'Broken Error', {
          status: 'ALERT',
          reason: 'RESIDUAL_SD_CRITICAL',
          frozenColumns: [],
        }),
      ],
    })
    expect(rows[0]!.monitoringReason).toBe('RESIDUAL_SD_CRITICAL')
  })

  it('carries STALE distinctly from SOURCE_UNREACHABLE', () => {
    const rows = buildAlerts({
      ...base,
      models: [
        monitoringModel('m-stale', 'Stale One', {
          status: 'ALERT',
          reason: 'STALE',
          frozenColumns: [],
        }),
      ],
    })
    expect(rows[0]!.monitoringReason).toBe('STALE')
  })

  /**
   * THE DUPLICATE-KEY GUARD. `alerts-group-list.tsx` keys its React children
   * on `${row.kind}-${row.id}`. A model can be BOTH deploy-failed (a refused
   * preflight) and monitoring-alerting, and those are two findings with two
   * different fixes — so they are two rows, and an unsuffixed id would make
   * React silently drop one of them.
   */
  it('emits TWO rows with distinct ids for a model failing on both axes', () => {
    const rows = buildAlerts({
      ...base,
      models: [
        monitoringModel(
          'm-both',
          'Doubly Broken',
          { status: 'ALERT', reason: 'STALE', frozenColumns: [] },
          { deployStatus: 'error' },
        ),
      ],
    })

    expect(rows).toHaveLength(2)
    const ids = rows.map(r => r.id)
    expect(new Set(ids).size).toBe(2)
    expect(rows.map(r => r.status).sort()).toEqual(['failed', 'monitoring'])
  })

  /**
   * `OFF` on the LIST payload means "no fault, no claim" — never "healthy",
   * and never an alert either. Raising a row for it would put every
   * unmonitored model in the workspace on this page.
   */
  it('raises nothing for OFF, UNKNOWN or OK', () => {
    const rows = buildAlerts({
      ...base,
      models: [
        monitoringModel('m-off', 'Off', {
          status: 'OFF',
          reason: null,
          frozenColumns: [],
        }),
        monitoringModel('m-unknown', 'Unknown', {
          status: 'UNKNOWN',
          reason: null,
          frozenColumns: [],
        }),
        monitoringModel('m-ok', 'OK', {
          status: 'OK',
          reason: null,
          frozenColumns: [],
        }),
      ],
    })
    expect(rows).toHaveLength(0)
  })

  /** A payload older than T26 carries no `monitoring` key at all. */
  it('raises nothing when the payload predates the monitoring field', () => {
    const model = monitoringModel('m-old', 'Legacy', {
      status: 'ALERT',
      reason: 'STALE',
      frozenColumns: [],
    })
    delete model.data!.monitoring
    const rows = buildAlerts({ ...base, models: [model] })
    expect(rows).toHaveLength(0)
  })

  /** Severity: a monitoring alert outranks a node alarm, and a dead deploy
   *  outranks it. Sorting is what puts the worst thing on screen first. */
  it('sorts below a failed deploy and above a node alarm', () => {
    const rows = buildAlerts({
      ...base,
      nodesByWorkspaceId: {
        [WS_ID]: [node('n1', PLANT_A, { status: 'alarm', name: 'Reactor A' })],
      },
      models: [
        failedModel('m-failed', 'Dead Deploy'),
        monitoringModel('m-mon', 'Stale One', {
          status: 'ALERT',
          reason: 'STALE',
          frozenColumns: [],
        }),
      ],
    })
    expect(rows.map(r => r.status)).toEqual(['failed', 'monitoring', 'alarm'])
  })
})

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
    expect(row!.typeName).toBe('Sensor')
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
    expect(row!.typeName).toBe('Model')
    expect(row!.detailError).toBe('R-squared dropped below 0.8')
    // MODEL-SERVE-001-T23: the real failure reason, and the row's timestamp
    // is the FAILURE time now, not the model's last-edit time.
    expect(row!.failureReason).toBe('connection timeout to PI database')
    expect(row!.timestamp).toBe('2026-06-29T10:00:00Z')
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

  it('filters by dateFrom/dateTo (inclusive bounds)', () => {
    // Fixture rows all carry timestamp '2026-06-29T00:00:00Z' (nodes) or
    // '2026-06-29T10:00:00Z' (the failed model's last error log).
    const inRange = filterAlerts(rows, {
      ...EMPTY_FILTERS,
      dateFrom: '2026-06-29T00:00:00Z',
      dateTo: '2026-06-29T10:00:00Z',
    })
    expect(inRange).toHaveLength(3)

    const excludesEverything = filterAlerts(rows, {
      ...EMPTY_FILTERS,
      dateFrom: '2026-07-01T00:00:00Z',
    })
    expect(excludesEverything).toHaveLength(0)

    const onlyModel = filterAlerts(rows, {
      ...EMPTY_FILTERS,
      dateFrom: '2026-06-29T05:00:00Z',
    })
    expect(onlyModel).toHaveLength(1)
    expect(onlyModel[0]!.modelName).toBe('Temp Predictor V1')
  })
})

describe('timestamp derivation', () => {
  it('uses node.updatedAt for node rows', () => {
    const [row] = buildAlerts({
      workspaces: [workspace()],
      plantsByWorkspaceId: { [WS_ID]: [plant(PLANT_A, 'Plant 1')] },
      nodesByWorkspaceId: {
        [WS_ID]: [node('n1', PLANT_A, { status: 'alarm', name: 'Reactor A' })],
      },
      models: [],
    })
    expect(row!.timestamp).toBe('2026-06-29T00:00:00Z')
  })

  it('uses the last error log timestamp for model rows when present', () => {
    const [row] = buildAlerts({
      workspaces: [workspace()],
      plantsByWorkspaceId: { [WS_ID]: [] },
      nodesByWorkspaceId: { [WS_ID]: [] },
      models: [failedModel('m1', 'Temp Predictor V1')],
    })
    expect(row!.timestamp).toBe('2026-06-29T10:00:00Z')
  })

  it('falls back to model.updatedAt when no failure reason is recorded', () => {
    const modelNoLogs: ModelWithWorkspace = {
      ...failedModel('m2', 'No Logs Model'),
      data: {
        deployStatus: 'error',
        enabled: true,
        prodStatus: 'offline',
        // MODEL-SERVE-001-T23: no FAILED row in the recent-terminal sample
        // the list payload is derived from.
        lastFailure: null,
        editHistory: [],
        logs: [],
      },
    }
    const [row] = buildAlerts({
      workspaces: [workspace()],
      plantsByWorkspaceId: { [WS_ID]: [] },
      nodesByWorkspaceId: { [WS_ID]: [] },
      models: [modelNoLogs],
    })
    expect(row!.timestamp).toBe('2026-06-29T00:00:00Z') // modelNoLogs.updatedAt
  })
})

describe('locationBreadcrumb', () => {
  it('stops at the plant for node rows (equipment is already the row title)', () => {
    const [row] = buildAlerts({
      workspaces: [workspace()],
      plantsByWorkspaceId: {
        [WS_ID]: [plant(PLANT_A, 'Plant 1')],
      },
      nodesByWorkspaceId: {
        [WS_ID]: [node('n1', PLANT_A, { status: 'alarm', name: 'Reactor A' })],
      },
      models: [],
    })
    expect(locationBreadcrumb(row!)).toEqual(['Repco', 'Plant 1'])
  })

  it('appends the affected equipment name for model rows linked to a node', () => {
    const [row] = buildAlerts({
      workspaces: [workspace()],
      plantsByWorkspaceId: { [WS_ID]: [] },
      nodesByWorkspaceId: { [WS_ID]: [] },
      models: [
        failedModel('m1', 'Vibration Model', {
          node: { name: 'Pump 02', planId: PLANT_B, planName: 'Plant 2' },
        }),
      ],
    })
    expect(locationBreadcrumb(row!)).toEqual(['Repco', 'Plant 2', 'Pump 02'])
  })

  it('is just the workspace for an unlinked model row', () => {
    const [row] = buildAlerts({
      workspaces: [workspace()],
      plantsByWorkspaceId: { [WS_ID]: [] },
      nodesByWorkspaceId: { [WS_ID]: [] },
      models: [failedModel('m2', 'Orphan Model')],
    })
    expect(locationBreadcrumb(row!)).toEqual(['Repco'])
  })
})

describe('groupByWorkspace', () => {
  const WS_A = 'ws-a'
  const WS_B = 'ws-b'

  function ws(id: string, name: string): Workspace {
    return {
      id,
      ownerId: 'owner-1',
      name,
      createdAt: '2026-06-29T00:00:00Z',
      updatedAt: '2026-06-29T00:00:00Z',
      _count: { members: 1, models: 0 },
      modelsCount: 0,
      status: 'normal',
    }
  }

  function nodeIn(
    wsId: string,
    id: string,
    status: CanvasNode['data']['status'],
    name: string,
  ): CanvasNode {
    return {
      id,
      workspaceId: wsId,
      planId: 'plan-1',
      data: { type: 'sensor', status, name, x: 0, y: 0 },
      models: [],
      createdAt: '2026-06-29T00:00:00Z',
      updatedAt: '2026-06-29T00:00:00Z',
    }
  }

  it('groups rows by workspace, severity-sorted within group, worst-group-first ordering', () => {
    const rows = buildAlerts({
      workspaces: [ws(WS_A, 'Zebra Plant'), ws(WS_B, 'Alpha Plant')],
      plantsByWorkspaceId: { [WS_A]: [], [WS_B]: [] },
      nodesByWorkspaceId: {
        // Zebra Plant: only a warning (least severe).
        [WS_A]: [nodeIn(WS_A, 'n1', 'warning', 'Warn Node')],
        // Alpha Plant: an alarm + a warning — alarm makes this group worse.
        [WS_B]: [
          nodeIn(WS_B, 'n2', 'warning', 'Warn Node 2'),
          nodeIn(WS_B, 'n3', 'alarm', 'Alarm Node'),
        ],
      },
      models: [],
    })

    const groups = groupByWorkspace(rows)
    expect(groups).toHaveLength(2)
    // Alpha Plant (has an alarm) ranks above Zebra Plant (only a warning),
    // even though 'Alpha' < 'Zebra' would also win alphabetically — the
    // severity ordering must be the primary key, not just alphabetical luck.
    expect(groups[0]!.workspaceName).toBe('Alpha Plant')
    expect(groups[0]!.rows.map(r => r.status)).toEqual(['alarm', 'warning'])
    expect(groups[1]!.workspaceName).toBe('Zebra Plant')
  })

  it('alphabetically tiebreaks groups of equal worst severity', () => {
    const rows = buildAlerts({
      workspaces: [ws(WS_A, 'Zebra Plant'), ws(WS_B, 'Alpha Plant')],
      plantsByWorkspaceId: { [WS_A]: [], [WS_B]: [] },
      nodesByWorkspaceId: {
        [WS_A]: [nodeIn(WS_A, 'n1', 'warning', 'Warn Node')],
        [WS_B]: [nodeIn(WS_B, 'n2', 'warning', 'Warn Node 2')],
      },
      models: [],
    })

    const groups = groupByWorkspace(rows)
    expect(groups.map(g => g.workspaceName)).toEqual([
      'Alpha Plant',
      'Zebra Plant',
    ])
  })
})
