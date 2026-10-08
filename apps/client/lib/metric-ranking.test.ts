import { describe, it, expect } from 'vitest'
import {
  DEFAULT_RANK_METRIC,
  RANK_DIRECTION,
  rankCandidates,
  rankingSummaryText,
  type RankableRow,
} from './metric-ranking'
import type { SourcedMetrics } from './metric-source'

function testSplit(rmse: number, over: Partial<{ r2: number }> = {}) {
  return {
    source: 'test-split',
    r2: over.r2 ?? 0.9,
    rmse,
    mae: 0.4,
  } satisfies SourcedMetrics
}

function holdout(rmse: number) {
  return {
    source: 'holdout',
    r2: -2.5,
    rmse,
    mae: 0.14,
    rowCount: 1153,
    droppedUnlabelled: 0,
    droppedBadFeatures: 0,
  } satisfies SourcedMetrics
}

function cvEstimate(meanRmse: number) {
  return {
    source: 'cv-fold-estimate',
    nSplits: 3,
    mean: { r2: 0.42, rmse: meanRmse, mae: 0.17 },
    std: { r2: 0.05, rmse: 0.017, mae: 0.01 },
  } satisfies SourcedMetrics
}

function row(
  id: string,
  sourcedMetrics: SourcedMetrics[],
  over: Partial<RankableRow> = {},
) {
  return { id, status: 'SUCCEEDED', sourcedMetrics, ...over }
}

const ids = <T extends { id: string }>(r: {
  entries: { row: T; rank: number | null }[]
}) => r.entries.map(e => [e.row.id, e.rank] as const)

describe('rankCandidates — which source ordered the list', () => {
  it('ranks on the holdout when every rankable row has one', () => {
    const result = rankCandidates([
      row('a', [testSplit(0.2), holdout(0.9)]),
      row('b', [testSplit(0.8), holdout(0.3)]),
    ])
    expect(result.orderingSource).toBe('holdout')
    expect(result.fallbackReason).toBeNull()
    // Ordered by the HOLDOUT, so b wins despite the worse test split — the
    // whole point of preferring the figure no fit ever saw.
    expect(ids(result)).toEqual([
      ['b', 1],
      ['a', 2],
    ])
  })

  it('falls back to the test split and names the fallback honest when the dataset has no holdout', () => {
    const result = rankCandidates([
      row('a', [testSplit(0.5)], { holdoutAbsence: 'no-dataset-holdout' }),
      row('b', [testSplit(0.4)], { holdoutAbsence: 'no-dataset-holdout' }),
    ])
    expect(result.orderingSource).toBe('test-split')
    expect(result.fallbackReason).toBe('no-dataset-holdout')
    expect(ids(result)).toEqual([
      ['b', 1],
      ['a', 2],
    ])
  })

  it('names a fallback that is covering for a DEFECT differently from an honest one', () => {
    // One row's holdout figure is missing that should be there — a run older
    // than the 2026-09-01 replay fix, or a failed replay. Ranking still
    // happens on the test split, but the reason is not "this dataset has
    // none", and a caller must be able to tell the two apart.
    const result = rankCandidates([
      row('a', [testSplit(0.5)], { holdoutAbsence: 'not-recorded' }),
      row('b', [testSplit(0.4), holdout(0.3)]),
    ])
    expect(result.orderingSource).toBe('test-split')
    expect(result.fallbackReason).toBe('holdout-not-recorded')
  })

  it('reports the loudest reason when a set mixes them', () => {
    const result = rankCandidates([
      row('a', [testSplit(0.5)], { holdoutAbsence: 'no-dataset-holdout' }),
      row('b', [testSplit(0.4)], { holdoutAbsence: 'not-scored-yet' }),
      row('c', [testSplit(0.6)], { holdoutAbsence: 'not-recorded' }),
    ])
    expect(result.fallbackReason).toBe('holdout-not-recorded')
  })

  it('ranks a CV set on its fold estimate only when that is all the set has', () => {
    const result = rankCandidates([
      row('a', [cvEstimate(0.31)]),
      row('b', [cvEstimate(0.22)]),
    ])
    expect(result.orderingSource).toBe('cv-fold-estimate')
    expect(ids(result)).toEqual([
      ['b', 1],
      ['a', 2],
    ])
  })

  it('prefers the holdout over a fold estimate for a scored CV set', () => {
    const result = rankCandidates([
      row('a', [cvEstimate(0.2), holdout(0.9)]),
      row('b', [cvEstimate(0.8), holdout(0.3)]),
    ])
    expect(result.orderingSource).toBe('holdout')
    expect(ids(result)).toEqual([
      ['b', 1],
      ['a', 2],
    ])
  })
})

describe('rankCandidates — never sorts a mixed column', () => {
  it('refuses to rank a set with no source every row shares', () => {
    // One CV run awaiting scoring beside one plain run: the first has only a
    // fold estimate, the second only a test split. Sorting 0.22 against 0.40
    // here would put an estimate of a configuration and a measurement of a
    // model in one column and call the result a ranking.
    const result = rankCandidates([
      row('cv', [cvEstimate(0.22)]),
      row('plain', [testSplit(0.4)]),
    ])
    expect(result.orderingSource).toBeNull()
    expect(result.entries.map(e => e.unranked)).toEqual([
      'no-shared-source',
      'no-shared-source',
    ])
    // Kept, in input order, never dropped and never silently sorted.
    expect(result.entries.map(e => e.row.id)).toEqual(['cv', 'plain'])
  })

  it('reports no fallback reason when nothing was ranked at all', () => {
    // There is no fallback without an ordering to fall back FROM. A set
    // that refused to rank must not also claim it "ranked on the test split
    // because a holdout figure was missing" — two different statements, and
    // only the refusal is true here.
    const result = rankCandidates([
      row('cv', [cvEstimate(0.22)], { holdoutAbsence: 'not-recorded' }),
      row('plain', [testSplit(0.4)], { holdoutAbsence: 'not-recorded' }),
    ])
    expect(result.orderingSource).toBeNull()
    expect(result.fallbackReason).toBeNull()
  })

  it('does not let one holdout-scored row drag a whole set onto the holdout', () => {
    const result = rankCandidates([
      row('a', [testSplit(0.5), holdout(0.1)]),
      row('b', [testSplit(0.4)], { holdoutAbsence: 'not-recorded' }),
    ])
    // b has no holdout, so the ordering runs on what BOTH have.
    expect(result.orderingSource).toBe('test-split')
    expect(result.entries.every(e => e.metric?.source === 'test-split')).toBe(
      true,
    )
  })
})

describe('rankCandidates — where a missing metric sorts, stated', () => {
  it('keeps every unrankable row, after the ranked ones, in input order, with its reason', () => {
    const result = rankCandidates([
      row('pending', [], { status: 'PENDING' }),
      row('failed', [], { status: 'FAILED' }),
      row('good', [testSplit(0.4)]),
      row('running', [], { status: 'RUNNING' }),
      row('better', [testSplit(0.2)]),
    ])
    expect(ids(result)).toEqual([
      ['better', 1],
      ['good', 2],
      ['pending', null],
      ['failed', null],
      ['running', null],
    ])
    expect(result.entries.slice(2).map(e => e.unranked)).toEqual([
      'no-run',
      'failed',
      'not-finished',
    ])
  })

  it('does not let a FAILED row change which source the set is ranked on', () => {
    const result = rankCandidates([
      row('failed', [], { status: 'FAILED' }),
      row('a', [testSplit(0.5), holdout(0.9)]),
      row('b', [testSplit(0.4), holdout(0.3)]),
    ])
    expect(result.orderingSource).toBe('holdout')
    expect(result.entries[2]?.unranked).toBe('failed')
  })

  it('ranks nothing when no row is eligible, rather than inventing an order', () => {
    const result = rankCandidates([
      row('a', [], { status: 'FAILED' }),
      row('b', [], { status: 'PENDING' }),
    ])
    expect(result.orderingSource).toBeNull()
    expect(result.entries.every(e => e.rank === null)).toBe(true)
    expect(rankCandidates([]).entries).toEqual([])
  })

  it('carries the figure WITH its source on every ranked row, never a bare number', () => {
    const result = rankCandidates([row('a', [testSplit(0.5), holdout(0.9)])])
    expect(result.entries[0]?.metric).toMatchObject({
      source: 'holdout',
      rowCount: 1153,
    })
    expect(result.entries[0]?.value).toBe(0.9)
  })
})

describe('rankCandidates — the metric and its direction', () => {
  it('defaults to rmse, minimised', () => {
    expect(DEFAULT_RANK_METRIC).toBe('rmse')
    expect(RANK_DIRECTION).toEqual({ rmse: 'min', mae: 'min', r2: 'max' })
  })

  it('maximises r2 rather than refusing it, pathological values included', () => {
    // MODEL-FLOW-005 observed a real run at r2 = -1,110,858. Ranking on r2
    // is a worse question than ranking on rmse, but it is still a defined
    // one — that row sorts last rather than being dropped or crashing.
    const result = rankCandidates(
      [
        row('sane', [testSplit(0.5, { r2: 0.88 })]),
        row('pathological', [testSplit(0.5, { r2: -1_110_858 })]),
      ],
      'r2',
    )
    expect(ids(result)).toEqual([
      ['sane', 1],
      ['pathological', 2],
    ])
  })

  it('marks a set with no shared value for the CHOSEN metric unranked rather than ordering a null as zero', () => {
    const noMae = {
      source: 'test-split',
      r2: 0.9,
      rmse: 0.5,
      mae: null,
    } satisfies SourcedMetrics
    const result = rankCandidates(
      [row('a', [noMae]), row('b', [testSplit(0.4)])],
      'mae',
    )
    expect(result.orderingSource).toBeNull()
    expect(result.entries.map(e => e.unranked)).toEqual([
      'no-shared-source',
      'no-shared-source',
    ])
  })
})

describe('rankingSummaryText — the ordering states itself', () => {
  it('names the holdout plainly when it ordered the set', () => {
    const result = rankCandidates([
      row('a', [testSplit(0.5), holdout(0.9)]),
      row('b', [testSplit(0.4), holdout(0.3)]),
    ])
    // 'Validate', the word `METRIC_SOURCE_LABELS` gives this source and
    // Step 4's own column header shows — this string is DERIVED from that
    // table, so it follows the rename rather than restating it.
    expect(rankingSummaryText(result)).toBe('Ranked by Validate RMSE.')
  })

  it('names the honest fallback distinctly from the one covering a defect', () => {
    const honest = rankCandidates([
      row('a', [testSplit(0.5)], { holdoutAbsence: 'no-dataset-holdout' }),
    ])
    expect(rankingSummaryText(honest)).toBe(
      'Ranked by Test RMSE — this dataset has no validation holdout.',
    )

    const defect = rankCandidates([
      row('a', [testSplit(0.5)], { holdoutAbsence: 'not-recorded' }),
      row('b', [testSplit(0.4), holdout(0.3)]),
    ])
    expect(rankingSummaryText(defect)).toBe(
      'Ranked by Test RMSE — one or more holdout scores are missing and should be present.',
    )
  })

  it('says plainly when nothing could be ranked', () => {
    const result = rankCandidates([
      row('cv', [cvEstimate(0.22)]),
      row('plain', [testSplit(0.4)]),
    ])
    expect(rankingSummaryText(result)).toBe(
      'Not ranked — no two rows here share a comparable score yet.',
    )
  })

  it('names the chosen metric, not only rmse', () => {
    const result = rankCandidates(
      [row('a', [testSplit(0.5, { r2: 0.7 })]), row('b', [testSplit(0.4)])],
      'r2',
    )
    expect(rankingSummaryText(result)).toBe('Ranked by Test R².')
  })
})

describe('rankCandidates — ties', () => {
  it('gives equal values the SAME rank and keeps their input order (1, 1, 3)', () => {
    const result = rankCandidates([
      row('first-seen', [testSplit(0.4)]),
      row('worse', [testSplit(0.9)]),
      row('second-seen', [testSplit(0.4)]),
    ])
    expect(ids(result)).toEqual([
      ['first-seen', 1],
      ['second-seen', 1],
      ['worse', 3],
    ])
  })
})
