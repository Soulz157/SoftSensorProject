import { describe, expect, it } from 'vitest'
import {
  applyConstantOverlay,
  chunkTags,
  dateToPiTime,
  mergeDataset,
  parseDurationMs,
  piResponseToDataset,
  previewWindow,
  resolveInterval,
  toPiTime,
  type PiDataFetchResponse,
} from './dataset-fetch'
import type { Dataset } from '@/lib/preprocessing'

const fixture: PiDataFetchResponse = {
  start_time: '2026-06-22 00:00:00.000000',
  end_time: '2026-06-22 00:02:00.000000',
  total_tags: 2,
  succeeded_tags: 1,
  failed_tags: 1,
  batch_size: 300,
  results: [
    {
      tag_name: 'TAG_A',
      status: 'ok',
      data: [
        { timestamp: '2026-06-22 00:00:00', value: 10.5 },
        { timestamp: '2026-06-22 00:01:00', value: null },
        { timestamp: '2026-06-22 00:02:00', value: 'Bad' },
      ],
    },
    {
      tag_name: 'TAG_B',
      status: 'failed',
      error: 'PI point not found',
      data: [{ timestamp: '2026-06-22 00:00:00', value: 3.3 }],
    },
  ],
}

describe('piResponseToDataset', () => {
  const ds = piResponseToDataset(fixture, ['TAG_A', 'TAG_B'])

  it('uses the supplied tag order', () => {
    expect(ds.tags).toEqual(['TAG_A', 'TAG_B'])
  })

  it('merges points from different tags onto one row per timestamp', () => {
    const first = ds.rows.find(r => r.timestamp === '2026-06-22 00:00:00')
    expect(first?.cells.TAG_A).toEqual({ value: 10.5, status: 'Good' })
    // TAG_B result failed → Bad even though the value is numeric.
    expect(first?.cells.TAG_B).toEqual({ value: 0, status: 'Bad' })
  })

  it('marks null and non-numeric values as Bad', () => {
    const nullRow = ds.rows.find(r => r.timestamp === '2026-06-22 00:01:00')
    const strRow = ds.rows.find(r => r.timestamp === '2026-06-22 00:02:00')
    expect(nullRow?.cells.TAG_A).toEqual({ value: 0, status: 'Bad' })
    expect(strRow?.cells.TAG_A).toEqual({ value: 0, status: 'Bad' })
  })

  it('sorts rows ascending by timestamp', () => {
    const stamps = ds.rows.map(r => r.timestamp)
    expect(stamps).toEqual([...stamps].sort())
  })

  it('falls back to result tag names when no tags passed', () => {
    expect(piResponseToDataset(fixture).tags).toEqual(['TAG_A', 'TAG_B'])
  })
})

describe('resolveInterval', () => {
  it('maps a period to a PI duration', () => {
    expect(resolveInterval('5min', null)).toBe('5m')
    expect(resolveInterval('1h', null)).toBe('1h')
  })

  it('prefers a custom interval', () => {
    expect(resolveInterval('1min', { value: 15, unit: 'min' })).toBe('15m')
    expect(resolveInterval('1min', { value: 2, unit: 'hr' })).toBe('2h')
    expect(resolveInterval('1min', { value: 1, unit: 'day' })).toBe('1d')
  })
})

describe('toPiTime', () => {
  it('converts a datetime-local value to PI time', () => {
    expect(toPiTime('2026-06-22T14:30')).toBe('2026-06-22 14:30:00')
  })

  it('returns empty for empty input', () => {
    expect(toPiTime('')).toBe('')
  })
})

describe('parseDurationMs', () => {
  it('parses each supported unit', () => {
    expect(parseDurationMs('30s')).toBe(30_000)
    expect(parseDurationMs('1m')).toBe(60_000)
    expect(parseDurationMs('10m')).toBe(600_000)
    expect(parseDurationMs('1h')).toBe(3_600_000)
    expect(parseDurationMs('1d')).toBe(86_400_000)
  })

  it('returns null for unrecognised / invalid durations', () => {
    expect(parseDurationMs('garbage')).toBeNull()
    expect(parseDurationMs('1mo')).toBeNull()
    expect(parseDurationMs('1M')).toBeNull()
    expect(parseDurationMs('0m')).toBeNull()
    expect(parseDurationMs('')).toBeNull()
  })
})

describe('dateToPiTime', () => {
  it('formats a local Date without UTC drift', () => {
    // Construct via local components so the assertion is timezone-independent.
    const d = new Date(2026, 6, 30, 11, 40, 0)
    expect(dateToPiTime(d)).toBe('2026-07-30 11:40:00')
  })
})

describe('previewWindow', () => {
  it('windows start → start + maxRows buckets (100 × 1m), no TZ drift', () => {
    const { startTime, endTime } = previewWindow(
      '2026-07-30T10:00',
      '2026-12-31T00:00',
      '1m',
      100,
    )
    expect(startTime).toBe('2026-07-30 10:00:00')
    expect(endTime).toBe('2026-07-30 11:40:00')
  })

  it('a bad duration falls back to a 1m bucket — NOT the full range', () => {
    const { endTime } = previewWindow(
      '2026-07-30T10:00',
      '2026-12-31T00:00',
      'garbage',
      100,
    )
    expect(endTime).toBe('2026-07-30 11:40:00')
  })

  it('caps the window at the real end when it is closer than maxRows buckets', () => {
    const { endTime } = previewWindow(
      '2026-07-30T10:00',
      '2026-07-30T10:30',
      '1m',
      100,
    )
    expect(endTime).toBe('2026-07-30 10:30:00')
  })
})

describe('applyConstantOverlay', () => {
  it('writes the constant as a flat Good series on every row', () => {
    const dataset: Dataset = {
      tags: ['t1', 'k'],
      rows: [
        {
          timestamp: '2026-06-22 00:00:00',
          cells: { t1: { value: 1, status: 'Good' } },
        },
        {
          timestamp: '2026-06-22 00:01:00',
          cells: { t1: { value: 2, status: 'Good' } },
        },
      ],
    }
    applyConstantOverlay(dataset, { k: 42 }, ['t1', 'k'])
    expect(dataset.rows[0]?.cells.k).toEqual({ value: 42, status: 'Good' })
    expect(dataset.rows[1]?.cells.k).toEqual({ value: 42, status: 'Good' })
  })

  it('ignores constants for tags outside the fetch set', () => {
    const dataset: Dataset = {
      tags: ['t1'],
      rows: [
        {
          timestamp: '2026-06-22 00:00:00',
          cells: { t1: { value: 1, status: 'Good' } },
        },
      ],
    }
    applyConstantOverlay(dataset, { k: 42 }, ['t1'])
    expect(dataset.rows[0]?.cells.k).toBeUndefined()
  })
})

describe('chunkTags', () => {
  it('splits evenly', () => {
    expect(chunkTags(['a', 'b', 'c', 'd'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('keeps the ragged final chunk', () => {
    expect(chunkTags(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
  })

  it('returns one chunk when size >= length', () => {
    expect(chunkTags(['a', 'b'], 10)).toEqual([['a', 'b']])
  })

  it('clamps size < 1 to 1 (never zero-length / infinite loop)', () => {
    expect(chunkTags(['a', 'b'], 0)).toEqual([['a'], ['b']])
    expect(chunkTags(['a', 'b'], -5)).toEqual([['a'], ['b']])
  })

  it('empty tags -> no chunks', () => {
    expect(chunkTags([], 3)).toEqual([])
  })
})

describe('mergeDataset', () => {
  it('backfills missing cells across ragged batch timestamps as Bad/0', () => {
    // Batch A: TAG_A at t0, t1.  Batch B: TAG_B at t1, t2.  Timestamp sets
    // differ by one row on each side.
    const a: Dataset = {
      tags: ['TAG_A'],
      rows: [
        { timestamp: 't0', cells: { TAG_A: { value: 1, status: 'Good' } } },
        { timestamp: 't1', cells: { TAG_A: { value: 2, status: 'Good' } } },
      ],
    }
    const b: Dataset = {
      tags: ['TAG_B'],
      rows: [
        { timestamp: 't1', cells: { TAG_B: { value: 8, status: 'Good' } } },
        { timestamp: 't2', cells: { TAG_B: { value: 9, status: 'Good' } } },
      ],
    }
    const merged = mergeDataset(a, b)

    expect(merged.tags).toEqual(['TAG_A', 'TAG_B'])
    // Every row carries a cell for every tag in the union.
    for (const row of merged.rows) {
      for (const tag of merged.tags) {
        expect(row.cells[tag]).toBeDefined()
      }
    }
    // The holes are the invariant Bad/0, not silently-Good 0.
    const t0 = merged.rows.find(r => r.timestamp === 't0')!
    expect(t0.cells.TAG_B).toEqual({ value: 0, status: 'Bad' })
    const t2 = merged.rows.find(r => r.timestamp === 't2')!
    expect(t2.cells.TAG_A).toEqual({ value: 0, status: 'Bad' })
    // Real overlapping reading survives.
    const t1 = merged.rows.find(r => r.timestamp === 't1')!
    expect(t1.cells.TAG_A).toEqual({ value: 2, status: 'Good' })
    expect(t1.cells.TAG_B).toEqual({ value: 8, status: 'Good' })
  })

  it('returns a fresh object (jotai must not Object.is-bail)', () => {
    const base: Dataset = { tags: [], rows: [] }
    const merged = mergeDataset(base, {
      tags: ['x'],
      rows: [{ timestamp: 't0', cells: { x: { value: 1, status: 'Good' } } }],
    })
    expect(merged).not.toBe(base)
    expect(merged.rows).not.toBe(base.rows)
  })

  it('sorts merged rows by timestamp', () => {
    const merged = mergeDataset(
      {
        tags: ['x'],
        rows: [{ timestamp: 't2', cells: { x: { value: 1, status: 'Good' } } }],
      },
      {
        tags: ['x'],
        rows: [{ timestamp: 't1', cells: { x: { value: 2, status: 'Good' } } }],
      },
    )
    expect(merged.rows.map(r => r.timestamp)).toEqual(['t1', 't2'])
  })
})
