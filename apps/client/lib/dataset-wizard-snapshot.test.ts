import { describe, expect, it } from 'vitest'
import {
  WIZARD_SNAPSHOT_VERSION,
  buildWizardSnapshot,
  clampStep,
  parseWizardSnapshot,
  planResume,
  restoreSourceConfigs,
  type WizardSnapshotValues,
} from './dataset-wizard-snapshot'

const VALUES: WizardSnapshotValues = {
  name: 'Boiler',
  description: '',
  workspaceId: 'ws-1',
  sourceIds: ['src-1'],
  selectedTags: ['T1', 'T2'],
  removedTags: [],
  editedTags: { T1: 'T1b' },
  insertedTags: [],
  csvUploadTags: [],
  csvFileName: '',
  tagConstants: { T9: 4.5 },
  tagUnits: { T1: null, T2: 'degC' },
  tagUnitOverrides: {},
  presetRange: [],
  presetRangeStale: false,
  fetchTags: ['T1', 'T2'],
  timeRange: '1min',
  customDateRange: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
  customInterval: null,
  holdoutRange: null,
  sourceFetchConfigs: {},
  fetchConfig: {} as WizardSnapshotValues['fetchConfig'],
  featureConfigs: [],
  featurePreset: null,
  targetTag: 'T2',
  sdtaPresets: [],
  edaWindow: null,
  cropRange: null,
  valueCrop: {},
  valueClip: {},
  exclusions: [],
  conditionalRules: [],
  statisticalRules: [],
  cleaningPipelines: {},
  cleaningTags: ['T1'],
  cleanedTags: [],
  selectedTagKeys: ['T1', 'T2'],
  selectedColumns: null,
  scalerConfigs: {},
  featureArtifactStamp: null,
  currentStep: 3,
  highestUnlocked: 4,
}

describe('dataset wizard snapshot (DS-LAKE-037)', () => {
  it('round-trips through JSON unchanged', () => {
    const wire = JSON.parse(JSON.stringify(buildWizardSnapshot(VALUES)))
    const parsed = parseWizardSnapshot(wire, WIZARD_SNAPSHOT_VERSION)
    expect(parsed).toEqual({ ok: true, values: VALUES })
  })

  it('refuses a snapshot written by another version', () => {
    expect(parseWizardSnapshot(buildWizardSnapshot(VALUES), 2)).toEqual({
      ok: false,
      reason: 'version',
    })
    expect(parseWizardSnapshot(buildWizardSnapshot(VALUES), null)).toEqual({
      ok: false,
      reason: 'version',
    })
  })

  it('names the first field whose shape is wrong', () => {
    const bad = { ...buildWizardSnapshot(VALUES), selectedTags: 'T1' }
    expect(parseWizardSnapshot(bad, WIZARD_SNAPSHOT_VERSION)).toEqual({
      ok: false,
      reason: 'shape',
      field: 'selectedTags',
    })
  })

  it('refuses a snapshot with a missing field and a non-object payload', () => {
    const { currentStep: _omit, ...rest } = buildWizardSnapshot(VALUES)
    expect(parseWizardSnapshot(rest, WIZARD_SNAPSHOT_VERSION)).toMatchObject({
      ok: false,
      field: 'currentStep',
    })
    expect(parseWizardSnapshot([], WIZARD_SNAPSHOT_VERSION).ok).toBe(false)
    expect(parseWizardSnapshot(null, WIZARD_SNAPSHOT_VERSION).ok).toBe(false)
  })

  it('carries no row data: the snapshot has no rows/dataset keys', () => {
    const keys = Object.keys(buildWizardSnapshot(VALUES))
    expect(keys.filter(k => /row|dataset|sample/i.test(k))).toEqual([])
  })

  it('clamps a step into the wizard range', () => {
    expect(clampStep(0, 6)).toBe(1)
    expect(clampStep(99, 6)).toBe(6)
    expect(clampStep(3.7, 6)).toBe(3)
  })
})

describe('source fetch configs carry no secrets or rows (DS-LAKE-037)', () => {
  const configs = {
    pi: {
      type: 'pi',
      piName: 'PI',
      piServerUrl: '\\\\host\\PI',
      calcType: 'Average',
      calcBasis: 'TimeWeighted',
      intervalTime: '1m',
      userName: 'svc',
      password: 'hunter2',
    },
    sql: { type: 'sql', connectionString: 'postgres://u:pw@h/db', query: '' },
    api: {
      type: 'rest_api',
      url: 'https://x',
      method: 'GET',
      headers: { Authorization: 'Bearer abc' },
      timestampField: 't',
      valueFields: [],
    },
    csv: { type: 'csv', fileName: 'a.csv', columns: ['a'], rows: [{ a: '1' }] },
    influx: { type: 'influxdb', url: 'u', bucket: 'b', org: 'o', token: 'tok' },
  } as unknown as WizardSnapshotValues['sourceFetchConfigs']

  it('keeps only the non-secret PI fields and omits every other source', () => {
    const wire = JSON.stringify(
      buildWizardSnapshot({ ...VALUES, sourceFetchConfigs: configs }),
    )
    for (const leaked of [
      'hunter2',
      'pw@h',
      'Bearer abc',
      '"rows"',
      'tok',
      'svc',
    ]) {
      expect(wire).not.toContain(leaked)
    }
    const kept = JSON.parse(wire).sourceFetchConfigs
    expect(Object.keys(kept)).toEqual(['pi'])
    expect(kept.pi.calcType).toBe('Average')
  })

  it('puts the PI userName back from the live source on restore', () => {
    const kept = {
      pi: {
        type: 'pi',
        piServerUrl: 'x',
        calcType: 'Average',
        calcBasis: 'TimeWeighted',
        intervalTime: '1m',
      },
    } as unknown as WizardSnapshotValues['sourceFetchConfigs']
    const restored = restoreSourceConfigs(kept, [{ id: 'pi', username: 'svc' }])
    expect(restored.pi).toMatchObject({ userName: 'svc' })
  })
})

describe('planResume — claims about server artifacts are not restored', () => {
  const stale: WizardSnapshotValues = {
    ...VALUES,
    cleanedTags: ['T1', 'T2'],
    featureArtifactStamp: 'stamp-1',
    cleaningPipelines: { T1: {} as never },
    cleaningTags: ['T1'],
  }

  it('empties cleanedTags and the feature stamp but keeps the cleaning pipelines', () => {
    const plan = planResume(stale, 6)
    expect(plan.values.cleanedTags).toEqual([])
    expect(plan.values.featureArtifactStamp).toBeNull()
    expect(plan.values.cleaningPipelines).toEqual(stale.cleaningPipelines)
    expect(plan.values.cleaningTags).toEqual(['T1'])
  })

  it('pulls Step 5/6 back to Step 4 so the feature artifact is rebuilt first', () => {
    for (const saved of [5, 6]) {
      const plan = planResume(
        { ...stale, currentStep: saved, highestUnlocked: 6 },
        6,
      )
      expect(plan.step).toBe(4)
      expect(plan.highestUnlocked).toBe(5)
      expect(plan.pulledBack).toBe(true)
    }
  })

  it('leaves an early step alone', () => {
    const plan = planResume({ ...stale, currentStep: 3, highestUnlocked: 3 }, 6)
    expect(plan).toMatchObject({
      step: 3,
      highestUnlocked: 3,
      pulledBack: false,
    })
  })
})
