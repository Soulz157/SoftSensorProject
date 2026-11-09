import { describe, expect, it } from 'vitest'
import { featureColumnName } from '@/lib/feature-engineering'
import {
  AUTO_FEATURE_ID_PREFIX,
  MAX_PAIR_TAGS,
  estimateRowCount,
  formatIntervalMs,
  hoursToRows,
  inferIntervalMs,
  isAutoFeature,
  planAutoFeatures,
  findLoopGroups,
  resolveFeatureInterval,
  selectionWithFeatures,
  withoutAutoFeatures,
  type AutoFeatureInput,
} from '@/lib/auto-features'

const HOUR = 3_600_000
const MIN = 60_000

let seq = 0
const base = (over: Partial<AutoFeatureInput> = {}): AutoFeatureInput => ({
  tags: ['FI-1', 'TI-2', 'Y.lab'],
  targetTag: 'Y.lab',
  intervalMs: HOUR,
  families: ['lag', 'rolling', 'delta', 'time'],
  pairTags: [],
  existingColumns: ['FI-1', 'TI-2', 'Y.lab'],
  rowCount: null,
  newId: () => `${AUTO_FEATURE_ID_PREFIX}${++seq}`,
  ...over,
})

describe('planAutoFeatures — hourly data', () => {
  it('converts the hour ladder to rows one-to-one and builds every family', () => {
    const plan = planAutoFeatures(base())
    expect(plan.lagRows).toEqual([1, 3, 6, 12, 24])
    expect(plan.rollingRows).toEqual([3, 6, 12, 24])
    // 2 source tags: 5 lags, 4 windows x mean/std, 1 delta each; 4 time.
    expect(plan.counts).toEqual({
      lag: 10,
      rolling: 16,
      delta: 2,
      pairwise: 0,
      loop: 0,
      time: 4,
    })
    expect(plan.notes).toEqual([])
  })

  it('never reads the target', () => {
    const cols = planAutoFeatures(base()).configs.map(featureColumnName)
    expect(cols.some(c => c.includes('Y.lab'))).toBe(false)
  })

  it('skips a column the frame already has', () => {
    const plan = planAutoFeatures(
      base({ existingColumns: ['FI-1', 'TI-2', 'FI-1__lag1', '__dt_hourSin'] }),
    )
    const cols = plan.configs.map(featureColumnName)
    expect(cols).not.toContain('FI-1__lag1')
    expect(cols).not.toContain('__dt_hourSin')
    expect(cols).toContain('__dt_hourCos')
    expect(new Set(cols).size).toBe(cols.length)
  })

  it('marks every config as auto-generated', () => {
    expect(planAutoFeatures(base()).configs.every(isAutoFeature)).toBe(true)
    expect(isAutoFeature({ id: 'hand-made' })).toBe(false)
  })

  it('builds only the families asked for', () => {
    const plan = planAutoFeatures(base({ families: ['delta'] }))
    expect(plan.configs.map(featureColumnName)).toEqual([
      'FI-1__delta',
      'TI-2__delta',
    ])
  })
})

describe('planAutoFeatures — other intervals', () => {
  it('1-minute data: lags in rows up to 24 h; rolling capped at 240 rows', () => {
    const plan = planAutoFeatures(base({ intervalMs: MIN }))
    expect(plan.lagRows).toEqual([60, 180, 360, 720, 1440])
    expect(plan.rollingRows).toEqual([180])
    expect(plan.notes.join(' ')).toMatch(
      /Rolling windows of 6 h, 12 h, 24 h are over 240 rows/,
    )
  })

  it('daily data: hour windows are under one row, hour of day is constant', () => {
    const plan = planAutoFeatures(base({ intervalMs: 24 * HOUR }))
    expect(plan.lagRows).toEqual([1])
    expect(plan.rollingRows).toEqual([])
    expect(plan.configs.map(featureColumnName)).not.toContain('__dt_hourSin')
    expect(plan.configs.map(featureColumnName)).toContain('__dt_dayOfWeekSin')
    expect(plan.notes.join(' ')).toMatch(/Hour of day is constant/)
  })

  it('an unknown interval leaves lags and windows out and says so', () => {
    const plan = planAutoFeatures(base({ intervalMs: null }))
    expect(plan.counts.lag + plan.counts.rolling).toBe(0)
    expect(plan.notes[0]).toMatch(/need the fetch interval/)
  })

  it('says how long rolling features take when it is minutes', () => {
    const plan = planAutoFeatures(
      base({ intervalMs: MIN, rowCount: 262_800, tags: tagNames(30) }),
    )
    expect(plan.notes.join(' ')).toMatch(
      /Rolling features will take about \d+ min/,
    )
  })
})

describe('planAutoFeatures — pairwise differences', () => {
  it('pairs the chosen tags once each, A − B', () => {
    const plan = planAutoFeatures(
      base({ families: ['pairwise'], pairTags: ['FI-1', 'TI-2'] }),
    )
    expect(plan.configs).toEqual([
      expect.objectContaining({
        kind: 'arith',
        op: 'sub',
        tags: ['FI-1', 'TI-2'],
      }),
    ])
  })

  it(`caps at ${MAX_PAIR_TAGS} tags (45 pairs) and drops the target`, () => {
    const tags = tagNames(14)
    const plan = planAutoFeatures(
      base({ tags, families: ['pairwise'], pairTags: [...tags, 'Y.lab'] }),
    )
    expect(plan.counts.pairwise).toBe(45)
    expect(plan.notes.join(' ')).toMatch(/first 10 of 14/)
  })

  it('needs two tags', () => {
    const plan = planAutoFeatures(
      base({ families: ['pairwise'], pairTags: ['FI-1'] }),
    )
    expect(plan.configs).toEqual([])
    expect(plan.notes).toContain(
      'Pairwise differences need at least 2 chosen tags.',
    )
  })
})

describe('interval helpers', () => {
  it('hoursToRows rounds to whole rows', () => {
    expect(hoursToRows(1, 10 * MIN)).toBe(6)
    expect(hoursToRows(3, 2 * HOUR)).toBe(2)
  })

  it('infers the cadence as the median gap, ignoring one outage', () => {
    const ts = [
      '2025-11-06 00:00:00',
      '2025-11-06 01:00:00',
      '2025-11-06 02:00:00',
      '2025-11-06 09:00:00',
      '2025-11-06 10:00:00',
    ]
    expect(inferIntervalMs(ts)).toBe(HOUR)
    expect(inferIntervalMs(['2025-11-06 00:00:00'])).toBeNull()
  })

  it('prefers the data cadence, then the fetch bucket', () => {
    expect(
      resolveFeatureInterval(
        ['2025-01-01 00:00:00', '2025-01-01 00:10:00'],
        '1h',
      ),
    ).toEqual({ ms: 10 * MIN, source: 'data' })
    expect(resolveFeatureInterval([], '1h')).toEqual({
      ms: HOUR,
      source: 'fetch',
    })
    expect(resolveFeatureInterval([], 'garbage')).toEqual({
      ms: null,
      source: null,
    })
  })

  it('estimates rows over the fetch window and formats the interval', () => {
    expect(estimateRowCount('2025-01-01T00:00', '2025-01-02T00:00', HOUR)).toBe(
      25,
    )
    expect(estimateRowCount(null, '2025-01-02T00:00', HOUR)).toBeNull()
    expect(formatIntervalMs(HOUR)).toBe('1 h')
    expect(formatIntervalMs(10 * MIN)).toBe('10 min')
    expect(formatIntervalMs(24 * HOUR)).toBe('1 d')
  })
})

function tagNames(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `T${i + 1}`)
}

describe('Step 4 batch helpers', () => {
  const plan = () => planAutoFeatures(base({ families: ['delta'] })).configs

  it('selectionWithFeatures keeps "all columns" as null and appends otherwise', () => {
    expect(selectionWithFeatures(null, plan())).toBeNull()
    expect(selectionWithFeatures(['FI-1', 'FI-1__delta'], plan())).toEqual([
      'FI-1',
      'FI-1__delta',
      'TI-2__delta',
    ])
  })

  it('withoutAutoFeatures removes only the generated batch and its columns', () => {
    const manual = { id: 'hand', kind: 'lag', tag: 'FI-1', k: 2 } as const
    const out = withoutAutoFeatures(
      [manual, ...plan()],
      ['FI-1', 'FI-1__lag2', 'FI-1__delta', 'TI-2__delta'],
    )
    expect(out.configs).toEqual([manual])
    expect(out.selected).toEqual(['FI-1', 'FI-1__lag2'])
    expect(withoutAutoFeatures(plan(), null).selected).toBeNull()
  })
})

describe('loop aggregates', () => {
  it('groups redundant analyzers and parallel passes, not neighbours or setpoints', () => {
    expect(
      findLoopGroups([
        'AI602A.PV',
        'AI602B.PV',
        'LI602.PV',
        'FIC114A.PV',
        'FIC114B.PV',
        'FIC114C.PV',
        'TI202.PV',
        'TI203.PV',
        'FIC107R.PV',
        'FY107.CPV',
        'AI602A.SP',
        'Spgr_in_feed_Header_1',
        's611water.lab',
      ]),
    ).toEqual([
      { loop: 'AI602', tags: ['AI602A.PV', 'AI602B.PV'] },
      { loop: 'FIC114', tags: ['FIC114A.PV', 'FIC114B.PV', 'FIC114C.PV'] },
    ])
  })

  it('keeps a non-PV attribute in the label', () => {
    expect(findLoopGroups(['AI602A.SP', 'AI602B.SP'])).toEqual([
      { loop: 'AI602.SP', tags: ['AI602A.SP', 'AI602B.SP'] },
    ])
  })

  it('builds mean, spread, min, max per loop and std from 3 tags', () => {
    const tags = [
      'AI602A.PV',
      'AI602B.PV',
      'FIC114A.PV',
      'FIC114B.PV',
      'FIC114C.PV',
    ]
    const plan = planAutoFeatures(
      base({
        tags,
        targetTag: null,
        families: ['loop'],
        loopGroups: findLoopGroups(tags),
      }),
    )
    expect(plan.configs.map(featureColumnName)).toEqual([
      'AI602__grp_mean',
      'AI602__grp_spread',
      'AI602__grp_min',
      'AI602__grp_max',
      'FIC114__grp_mean',
      'FIC114__grp_spread',
      'FIC114__grp_min',
      'FIC114__grp_max',
      'FIC114__grp_std',
    ])
    expect(plan.configs[0]).toMatchObject({
      kind: 'group',
      tags: ['AI602A.PV', 'AI602B.PV'],
      agg: 'mean',
    })
  })

  it('drops the target and unchosen tags from a loop, and a loop left with one', () => {
    const tags = ['AI602A.PV', 'AI602B.PV']
    const plan = planAutoFeatures(
      base({
        tags,
        targetTag: 'AI602B.PV',
        families: ['loop'],
        loopGroups: findLoopGroups(tags),
      }),
    )
    expect(plan.configs).toEqual([])
    expect(plan.notes.join(' ')).toMatch(/No loop has 2 or more chosen tags/)
  })
})
