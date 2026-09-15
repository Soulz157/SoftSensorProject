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
    plane: 'predict',
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
      piStatus: null,
      derivedFeatures: null,
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
      piStatus: null,
      derivedFeatures: null,
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ column: 'PI-204.PV', driftStatus: 'WARN' })
    expect(rows[1]).toMatchObject({
      column: 'FC-310.PV',
      driftStatus: 'UNKNOWN',
    })
  })

  it('left-joins PI status — a column absent from it gets UNKNOWN, never Good', () => {
    const rows = buildInputFeatureRows({
      featureColumns: ['PI-204.PV', 'FC-310.PV'],
      versionId: VERSION_ID,
      points: [],
      drift: null,
      piStatus: {
        features: [
          {
            column: 'PI-204.PV',
            status: 'Bad',
            reason: 'PI reports this tag as Bad.',
            failingSources: ['PI-204.PV'],
          },
        ],
        unavailableReason: null,
      },
      derivedFeatures: null,
    })

    expect(rows[0]).toMatchObject({
      column: 'PI-204.PV',
      piStatus: 'Bad',
      failingSources: ['PI-204.PV'],
    })
    // The absent one must not silently read healthy — PI said nothing
    // about it, which is not the same as saying it is fine.
    expect(rows[1]).toMatchObject({ column: 'FC-310.PV', piStatus: 'UNKNOWN' })
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
      piStatus: null,
      derivedFeatures: null,
    })

    expect(rows[0]?.lastSeen).toBe('2026-09-06T10:00:00.000Z')
    expect(rows[0]?.lastValueRaw).toBe(0.5)
  })

  it('falls back to null when a column was never logged', () => {
    const rows = buildInputFeatureRows({
      featureColumns: ['TI-101.PV'],
      versionId: VERSION_ID,
      points: [],
      drift: null,
      piStatus: null,
      derivedFeatures: null,
    })

    expect(rows[0]?.lastSeen).toBeNull()
    expect(rows[0]?.lastValueRaw).toBeNull()
  })

  /**
   * T12. The value this stream carries is the `/predict` request's own RAW
   * reading — `apps/serving`'s `log_prediction` logs from `rows`, never
   * `scaled` (see `lib/model-input-features.ts`'s own doc comment for the
   * full trace). Retargeted 2026-09-14: this case USED TO assert
   * `buildInputFeatureRows` inverse-scaled a logged value through
   * `scalingParams` — that behaviour was the bug (a real ~190 reading
   * rendered as ~5,309 against real min/max params), not a feature to
   * preserve. There is no scaler input to this function any more; a
   * logged value survives untouched.
   */
  it('never scales a logged value — it is already engineering units', () => {
    const rows = buildInputFeatureRows({
      featureColumns: ['TI-101.PV'],
      versionId: VERSION_ID,
      points: [point({ features: { 'TI-101.PV': 190.4 } })],
      drift: null,
      piStatus: null,
      derivedFeatures: null,
    })

    expect(rows[0]?.lastValueRaw).toBe(190.4)
  })

  it('excludes points from a different modelVersionId from lastValueRaw/lastSeen', () => {
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
      piStatus: null,
      derivedFeatures: null,
    })

    expect(rows[0]?.lastSeen).toBeNull()
    expect(rows[0]?.lastValueRaw).toBeNull()
  })

  /** T12. The equation-under-the-tag join — keyed by feature NAME, not by
   *  any relationship to `points`/`drift`, so it applies even to a column
   *  with zero logged traffic. */
  it("attaches a derived feature's equation by name; a base tag gets none", () => {
    const rows = buildInputFeatureRows({
      featureColumns: ['FIC204.PV', 'Reflux_ratio'],
      versionId: VERSION_ID,
      points: [],
      drift: null,
      piStatus: null,
      derivedFeatures: [
        { name: 'Reflux_ratio', display: 'FIC204.PV/(FY107.CPV+1)' },
      ],
    })

    expect(rows[0]).toMatchObject({ column: 'FIC204.PV', equation: null })
    expect(rows[1]).toMatchObject({
      column: 'Reflux_ratio',
      equation: 'FIC204.PV/(FY107.CPV+1)',
    })
  })
})
