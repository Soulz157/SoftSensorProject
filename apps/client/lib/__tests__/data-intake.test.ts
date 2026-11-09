import { describe, expect, it } from 'vitest'
import type { Workspace } from '@/types'
import type { IntakeTotals, TagCounts, TagRow } from '@/types/data-intake'
import { formatBytes } from '@/lib/format-bytes'
import {
  canViewScope,
  filterTagRows,
  formatCount,
  formatPct,
  formatRelative,
  ingestionChartRows,
  storageShare,
  summaryCells,
  tagSegments,
  totalTags,
} from '../data-intake'

function ws(id: string): Workspace {
  return {
    id,
    ownerId: 'u1',
    name: `Workspace ${id}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    _count: { members: 1, models: 0 },
    status: 'normal',
  }
}

const counts = (over: Partial<TagCounts> = {}): TagCounts => ({
  good: 0,
  bad: 0,
  questionable: 0,
  noReading: 0,
  notLive: 0,
  ...over,
})

const row = (over: Partial<TagRow>): TagRow => ({
  modelId: 'm1',
  modelName: 'Model 1',
  tag: 'FI001.PV',
  quality: 'good',
  lastValue: 1,
  lastSeenAt: null,
  heldMinutes: null,
  ...over,
})

describe('canViewScope', () => {
  const mine = [ws('a'), ws('b')]

  it('allows the all-workspaces scope (its route is admin-guarded)', () => {
    expect(canViewScope('all', mine)).toBe(true)
  })

  it('allows a member workspace', () => {
    expect(canViewScope('a', mine)).toBe(true)
  })

  it('refuses a workspace missing from the viewer list', () => {
    expect(canViewScope('z', mine)).toBe(false)
  })
})

describe('filterTagRows', () => {
  const rows = [
    row({ tag: 'A', quality: 'bad' }),
    row({ tag: 'B', quality: 'good' }),
    row({ tag: 'C', quality: 'notLive' }),
  ]

  it('returns every row for "all"', () => {
    expect(filterTagRows(rows, 'all')).toHaveLength(3)
  })

  it('narrows to one quality', () => {
    expect(filterTagRows(rows, 'bad').map(r => r.tag)).toEqual(['A'])
    expect(filterTagRows(rows, 'questionable')).toEqual([])
  })
})

describe('tagSegments / totalTags', () => {
  it('has no segments when nothing is counted', () => {
    expect(totalTags(counts())).toBe(0)
    expect(tagSegments(counts())).toEqual([])
  })

  it('omits empty qualities and sums to 100%', () => {
    const segs = tagSegments(counts({ good: 6, bad: 2, notLive: 2 }))
    expect(segs.map(s => s.quality)).toEqual(['good', 'bad', 'notLive'])
    expect(segs.reduce((sum, s) => sum + s.pct, 0)).toBeCloseTo(100)
    expect(segs[0]?.pct).toBeCloseTo(60)
  })
})

describe('formatters', () => {
  it('compacts counts', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1234)).toBe('1.2k')
    expect(formatCount(25_000)).toBe('25k')
    expect(formatCount(3_400_000)).toBe('3.4M')
  })

  it('shows an unknown percentage as a dash, never 0', () => {
    expect(formatPct(null)).toBe('—')
    expect(formatPct(0)).toBe('0.00%')
    expect(formatPct(2.5)).toBe('2.50%')
    expect(formatPct(12.34)).toBe('12.3%')
  })

  it('formats relative ages against a fixed reference time', () => {
    const now = new Date('2026-11-06T12:30:00.000Z')
    expect(formatRelative(null, now)).toBe('—')
    expect(formatRelative('2026-11-06T12:30:00.000Z', now)).toBe('just now')
    expect(formatRelative('2026-11-06T12:25:00.000Z', now)).toBe('5m ago')
    expect(formatRelative('2026-11-06T09:30:00.000Z', now)).toBe('3h ago')
    expect(formatRelative('2026-11-04T12:30:00.000Z', now)).toBe('2d ago')
  })

  it('formats bytes up to TB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(361_017_589)).toBe('344.3 MB')
    expect(formatBytes(2 * 1024 ** 4)).toBe('2.0 TB')
  })
})

describe('storageShare', () => {
  it('is relative to the largest dataset and safe for zero', () => {
    expect(storageShare(50, 200)).toBe(25)
    expect(storageShare(200, 200)).toBe(100)
    expect(storageShare(10, 0)).toBe(0)
  })
})

describe('summaryCells', () => {
  const totals: IntakeTotals = {
    liveModels: 2,
    tags: counts({ good: 10, questionable: 1, bad: 2, notLive: 4 }),
    rowsIngested: 12_345,
    badCellPct: null,
    storage: {
      savedBytes: 2048,
      activeDraftBytes: 1024,
      cleanupBytes: 1024,
      totalBytes: 4096,
    },
    datasetCount: 3,
  }

  it('counts only live-classified tags as "Live tags"', () => {
    const cells = summaryCells(totals)
    const live = cells.find(c => c.key === 'live-tags')
    expect(live?.value).toBe('13')
    expect(live?.hint).toBe('10 Good · 1 Questionable · 2 Bad')
  })

  it('shows unknown bad-cell % as a dash and splits storage', () => {
    const cells = summaryCells(totals)
    expect(cells.find(c => c.key === 'bad-cells')?.value).toBe('—')
    const storage = cells.find(c => c.key === 'storage')
    expect(storage?.value).toBe('4.0 KB')
    expect(storage?.hint).toBe('2.0 KB saved · 2.0 KB drafts')
  })
})

describe('ingestionChartRows', () => {
  it('keeps every point and adds a label', () => {
    const points = [
      {
        bucketStart: '2026-11-06T10:00:00.000Z',
        scheduledRows: 5,
        predictRows: 1,
        badCellPct: 1.5,
      },
    ]
    for (const range of ['24h', '7d', '1m', '1y'] as const) {
      const out = ingestionChartRows(points, range)
      expect(out).toHaveLength(1)
      expect(out[0]?.label.length).toBeGreaterThan(0)
      expect(out[0]?.scheduledRows).toBe(5)
    }
  })
})
