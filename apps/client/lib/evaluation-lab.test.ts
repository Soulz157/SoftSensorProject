import { describe, expect, it } from 'vitest'
import {
  activeLab,
  addLabRow,
  addLabRows,
  editLabRow,
  labChangeCount,
  parseLabCsvPlantTime,
  removeLabRow,
  restoreLabRow,
  seedLab,
} from './evaluation-lab'

const T1 = '2026-10-14T01:00:00.000Z'
const T2 = '2026-10-14T02:00:00.000Z'
const seed = () =>
  seedLab([
    { t: T2, value: 2 },
    { t: T1, value: 1 },
  ])

describe('seedLab', () => {
  it('sorts by time and marks every row imported with its original', () => {
    const rows = seed()
    expect(rows.map(r => r.timestamp)).toEqual([T1, T2])
    expect(rows.every(r => r.origin === 'imported' && !r.removed)).toBe(true)
    expect(rows[0]?.originalValue).toBe(1)
  })
})

describe('editLabRow', () => {
  it('marks a changed imported row edited and keeps the original', () => {
    const rows = editLabRow(seed(), T1, 9)
    expect(rows[0]).toMatchObject({
      value: 9,
      origin: 'edited',
      originalValue: 1,
    })
    expect(rows[1]?.origin).toBe('imported')
  })

  it('setting an edited row back to its original makes it imported again', () => {
    const rows = editLabRow(editLabRow(seed(), T1, 9), T1, 1)
    expect(rows[0]?.origin).toBe('imported')
  })

  it('finds the row by instant, however the timestamp is spelled', () => {
    const rows = editLabRow(seed(), '2026-10-14T01:00:00Z', 9)
    expect(rows[0]?.value).toBe(9)
  })

  it('editing a removed imported row brings it back', () => {
    const rows = editLabRow(removeLabRow(seed(), T1), T1, 9)
    expect(rows[0]).toMatchObject({ removed: false, origin: 'edited' })
  })

  it('ignores a non-finite value', () => {
    expect(editLabRow(seed(), T1, Number.NaN)[0]?.value).toBe(1)
  })

  it('leaves an added row an added row', () => {
    const rows = editLabRow(
      addLabRow(seed(), { timestamp: '2026-10-14T03:00:00Z', value: 5 }),
      '2026-10-14T03:00:00.000Z',
      6,
    )
    expect(rows[2]).toMatchObject({
      value: 6,
      origin: 'added',
      originalValue: null,
    })
  })
})

describe('addLabRow', () => {
  it('adds a new point in time order', () => {
    const rows = addLabRow(seed(), {
      timestamp: '2026-10-14T01:30:00Z',
      value: 5,
    })
    expect(rows.map(r => r.value)).toEqual([1, 5, 2])
    expect(rows[1]?.origin).toBe('added')
  })

  it('a point on an imported timestamp is an EDIT of that row, not a duplicate', () => {
    const rows = addLabRow(seed(), {
      timestamp: '2026-10-14T01:00:00Z',
      value: 7,
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      value: 7,
      origin: 'edited',
      originalValue: 1,
    })
  })

  it('refuses a non-finite value or a bad timestamp', () => {
    expect(
      addLabRow(seed(), { timestamp: T1, value: Number.NaN }),
    ).toHaveLength(2)
    expect(addLabRow(seed(), { timestamp: 'nope', value: 1 })).toHaveLength(2)
  })

  it('addLabRows applies many', () => {
    expect(
      addLabRows(seed(), [
        { timestamp: '2026-10-14T03:00:00Z', value: 3 },
        { timestamp: '2026-10-14T04:00:00Z', value: 4 },
      ]),
    ).toHaveLength(4)
  })
})

describe('removeLabRow / restoreLabRow', () => {
  it('removes an imported row from the comparison but keeps it restorable', () => {
    const rows = removeLabRow(seed(), T1)
    expect(rows[0]?.removed).toBe(true)
    expect(activeLab(rows).map(p => p.value)).toEqual([2])
    expect(activeLab(restoreLabRow(rows, T1)).map(p => p.value)).toEqual([1, 2])
  })

  it('deletes an added row outright', () => {
    const added = addLabRow(seed(), {
      timestamp: '2026-10-14T03:00:00Z',
      value: 3,
    })
    expect(removeLabRow(added, '2026-10-14T03:00:00.000Z')).toHaveLength(2)
  })
})

describe('labChangeCount', () => {
  it('counts edited, added and removed; imported untouched is zero', () => {
    expect(labChangeCount(seed())).toBe(0)
    let rows = editLabRow(seed(), T1, 9)
    rows = addLabRow(rows, { timestamp: '2026-10-14T03:00:00Z', value: 3 })
    rows = removeLabRow(rows, T2)
    expect(labChangeCount(rows)).toBe(3)
  })

  it('an edit reverted to the original no longer counts', () => {
    expect(labChangeCount(editLabRow(editLabRow(seed(), T1, 9), T1, 1))).toBe(0)
  })
})

describe('parseLabCsvPlantTime', () => {
  it('reads a zone-less timestamp as plant time (UTC+7), not the browser zone', () => {
    const { points, errors } = parseLabCsvPlantTime(
      'timestamp,value\n2026-10-14 07:00,12.5\n',
    )
    expect(errors).toEqual([])
    expect(points).toEqual([
      { timestamp: '2026-10-14T00:00:00.000Z', value: 12.5 },
    ])
  })

  it('keeps seconds and accepts a T separator', () => {
    const { points } = parseLabCsvPlantTime('2026-10-14T07:00:30,1\n')
    expect(points[0]?.timestamp).toBe('2026-10-14T00:00:30.000Z')
  })

  it('leaves a stamp that already carries a zone exactly as it is', () => {
    const { points } = parseLabCsvPlantTime(
      '2026-10-14T07:00:00Z,1\n2026-10-14T07:00:00+07:00,2\n',
    )
    expect(points.map(p => p.timestamp)).toEqual([
      '2026-10-14T07:00:00.000Z',
      '2026-10-14T00:00:00.000Z',
    ])
  })

  it('still reports unparseable rows', () => {
    const { points, errors } = parseLabCsvPlantTime(
      'timestamp,value\n2026-10-14 07:00,abc\nnot-a-date,5\n',
    )
    expect(points).toEqual([])
    expect(errors).toHaveLength(2)
  })
})
