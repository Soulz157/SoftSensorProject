import { describe, it, expect } from 'vitest'
import { buildInputFeatureRows } from '@/lib/model-input-features'
import type { DriftReport } from '@/services/model-monitoring'
import type { LivePredictionPoint } from '@/hooks/model/use-prediction-monitoring'

const VERSION_ID = 'version-1'

const DRIFT: DriftReport = {
  status: 'WARN',
  columns: [
    {
      column: 'PI-204.PV',
      n: 4,
      liveMean: 3.02,
      liveStd: 0.1,
      trainMean: 2.5,
      trainStd: 0.2,
      z: 2.6,
      outOfRangePct: 1.2,
      status: 'WARN',
      reason: undefined,
    },
  ],
  basis: {
    modelVersionId: VERSION_ID,
    version: 1,
    goldArtifactId: 'gold-1',
    goldObjectKey: 'ds-1/artifacts/gold-1/data_gold.parquet',
    sampleRequests: 4,
    from: '2026-09-06T00:00:00.000Z',
    to: '2026-09-07T00:00:00.000Z',
  },
}

function point(
  overrides: Partial<LivePredictionPoint> = {},
): LivePredictionPoint {
  return {
    timestamp: '2026-09-06T12:00:00.000Z',
    predicted: 10,
    features: {},
    modelVersionId: VERSION_ID,
    ...overrides,
  }
}

describe('buildInputFeatureRows', () => {
  it('preserves featureColumns order, never re-sorted', () => {
    const rows = buildInputFeatureRows({
      featureColumns: ['FC-310.PV', 'TI-101.PV', 'PI-204.PV'],
      versionId: VERSION_ID,
      points: [],
      drift: null,
      scalingParams: null,
    })

    expect(rows.map(r => r.column)).toEqual([
      'FC-310.PV',
      'TI-101.PV',
      'PI-204.PV',
    ])
  })

  it('left-joins drift — a column absent from drift.columns gets UNKNOWN, never dropped', () => {
    const rows = buildInputFeatureRows({
      featureColumns: ['PI-204.PV', 'FC-310.PV'],
      versionId: VERSION_ID,
      points: [],
      drift: DRIFT,
      scalingParams: null,
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ column: 'PI-204.PV', driftStatus: 'WARN' })
    expect(rows[1]).toMatchObject({
      column: 'FC-310.PV',
      driftStatus: 'UNKNOWN',
    })
  })

  it('picks the newest point that actually contains the key, not simply the last point in the array', () => {
    const rows = buildInputFeatureRows({
      featureColumns: ['TI-101.PV'],
      versionId: VERSION_ID,
      points: [
        point({
          timestamp: '2026-09-06T10:00:00.000Z',
          features: { 'TI-101.PV': 0.5 },
        }),
        // "last" in array order, but does NOT carry TI-101.PV.
        point({
          timestamp: '2026-09-06T11:00:00.000Z',
          features: { 'PI-204.PV': 0.1 },
        }),
      ],
      drift: null,
      scalingParams: null,
    })

    expect(rows[0]?.lastSeen).toBe('2026-09-06T10:00:00.000Z')
    expect(rows[0]?.lastValueScaled).toBe(0.5)
  })

  it('falls back to null when a column was never logged', () => {
    const rows = buildInputFeatureRows({
      featureColumns: ['TI-101.PV'],
      versionId: VERSION_ID,
      points: [],
      drift: null,
      scalingParams: null,
    })

    expect(rows[0]?.lastSeen).toBeNull()
    expect(rows[0]?.lastValue).toBeNull()
    expect(rows[0]?.lastValueScaled).toBeNull()
  })

  it('inverts a scaled value to engineering units when scalingParams are recorded', () => {
    const rows = buildInputFeatureRows({
      featureColumns: ['TI-101.PV'],
      versionId: VERSION_ID,
      points: [point({ features: { 'TI-101.PV': 0.5 } })],
      drift: null,
      scalingParams: { 'TI-101.PV': { min: 0, max: 100 } },
    })

    expect(rows[0]?.lastValue).toBe(50)
    expect(rows[0]?.lastValueScaled).toBe(0.5)
  })

  it('falls back to null (not the raw scaled number) when scalingParams cannot invert it', () => {
    const rows = buildInputFeatureRows({
      featureColumns: ['TI-101.PV'],
      versionId: VERSION_ID,
      points: [point({ features: { 'TI-101.PV': 0.5 } })],
      drift: null,
      scalingParams: null,
    })

    expect(rows[0]?.lastValue).toBeNull()
    expect(rows[0]?.lastValueScaled).toBe(0.5)
  })

  it('excludes points from a different modelVersionId from lastValue/lastSeen', () => {
    const rows = buildInputFeatureRows({
      featureColumns: ['TI-101.PV'],
      versionId: VERSION_ID,
      points: [
        point({
          modelVersionId: 'other-version',
          timestamp: '2026-09-07T00:00:00.000Z',
          features: { 'TI-101.PV': 0.9 },
        }),
      ],
      drift: null,
      scalingParams: null,
    })

    expect(rows[0]?.lastSeen).toBeNull()
    expect(rows[0]?.lastValueScaled).toBeNull()
  })
})
