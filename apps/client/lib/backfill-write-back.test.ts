import { describe, expect, it } from 'vitest'
import {
  predictionPoints,
  pointsFor,
  writeBlocker,
  WRITE_MAX_POINTS,
} from './backfill-write-back'
import { seedLab, removeLabRow, editLabRow } from './backfill-lab'
import type { WriteBackConfigView } from '@/services/model-backfill'

const T1 = '2026-10-14T01:00:00.000Z'
const T2 = '2026-10-14T02:00:00.000Z'
const point = (t: string, predicted: number | null) => ({
  t,
  predicted,
  skippedReason: null,
})
const data = { points: [point(T1, 10), point(T2, null)] }
const rows = seedLab([
  { t: T1, value: 1 },
  { t: T2, value: 2 },
])

function view(over: Partial<WriteBackConfigView> = {}): WriteBackConfigView {
  return {
    config: {
      sourceId: 's',
      predictionTag: 'OUT.PRED',
      labTag: 'OUT.LAB',
      updatedAt: T1,
    },
    canWrite: true,
    source: {
      id: 's',
      name: 'PI',
      type: 'aveva',
      piAccount: 'svc',
      writable: true,
    },
    sourceChanged: false,
    targetTag: 'LAB.Y',
    ...over,
  }
}
const blocker = (over: Partial<Parameters<typeof writeBlocker>[0]> = {}) =>
  writeBlocker({ kind: 'PREDICTION', view: view(), data, rows, ...over })

describe('points', () => {
  it('predictions: scored rows only, never a placeholder for a gap', () => {
    expect(predictionPoints(data)).toEqual([{ timestamp: T1, value: 10 }])
  })

  it('lab: the series as edited on the page, removals out', () => {
    const edited = removeLabRow(editLabRow(rows, T1, 9), T2)
    expect(pointsFor('LAB', data, edited)).toEqual([
      { timestamp: T1, value: 9 },
    ])
  })
})

describe('writeBlocker', () => {
  it('null when everything is in place', () => {
    expect(blocker()).toBeNull()
    expect(blocker({ kind: 'LAB' })).toBeNull()
  })

  it.each([
    ['settings still loading', { view: null }, /Loading/],
    [
      'not an owner / admin',
      { view: view({ canWrite: false }) },
      /owner or an admin/,
    ],
    [
      'no data source',
      { view: view({ source: null }) },
      /no production data source/,
    ],
    [
      'a non-PI source',
      {
        view: view({
          source: {
            id: 's',
            name: 'DB',
            type: 'sql',
            piAccount: '',
            writable: false,
          },
        }),
      },
      /source is sql/,
    ],
    [
      'source re-pointed',
      { view: view({ sourceChanged: true }) },
      /Re-save the output tags/,
    ],
    [
      'no prediction tag',
      {
        view: view({
          config: {
            sourceId: 's',
            predictionTag: null,
            labTag: 'L',
            updatedAt: T1,
          },
        }),
      },
      /Set the prediction output tag/,
    ],
    [
      'no config at all',
      { view: view({ config: null }) },
      /Set the prediction output tag/,
    ],
    ['nothing imported', { data: null }, /Import a range first/],
    [
      'no scored predictions',
      { data: { points: [point(T1, null)] } },
      /No scored predictions/,
    ],
  ])('refuses: %s', (_l, over, text) => {
    expect(blocker(over)).toMatch(text)
  })

  it('names the LAB tag for a lab write', () => {
    const v = view({
      config: {
        sourceId: 's',
        predictionTag: 'P',
        labTag: null,
        updatedAt: T1,
      },
    })
    expect(blocker({ kind: 'LAB', view: v })).toMatch(/Set the lab output tag/)
  })

  it('no lab values left to write', () => {
    expect(
      blocker({ kind: 'LAB', rows: removeLabRow(removeLabRow(rows, T1), T2) }),
    ).toMatch(/No lab values/)
  })

  it('over the per-batch limit', () => {
    const big = {
      points: Array.from({ length: WRITE_MAX_POINTS + 1 }, (_, i) =>
        point(new Date(Date.UTC(2026, 9, 14, 0, i)).toISOString(), 1),
      ),
    }
    expect(blocker({ data: big })).toMatch(/over the 2000-point limit/)
  })
})
