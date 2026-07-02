import { describe, it, expect } from 'vitest'
import {
  buildRawDataset,
  preprocess,
  toModelReady,
  toScatterPoints,
  linearRegression,
  datasetStats,
  CORRELATED_PAIR,
  type Dataset,
  type FillStrategyConfig,
} from '@/lib/preprocessing'

// Fixed clock so the deterministic mock is reproducible across runs.
const FIXED_NOW = Date.UTC(2026, 0, 15, 12, 0, 0)
const PAIR = [CORRELATED_PAIR.anchor, CORRELATED_PAIR.derived]

function r2(ds: Dataset): number {
  const points = toScatterPoints(
    ds,
    CORRELATED_PAIR.anchor,
    CORRELATED_PAIR.derived,
  )
  return linearRegression(points).r2
}

describe('preprocessing — correlated pair (scatter regression)', () => {
  it('raw dataset has a strong, fittable correlation', () => {
    const raw = buildRawDataset(PAIR, '24h', FIXED_NOW)
    expect(raw.rows.length).toBeGreaterThan(0)
    expect(r2(raw)).toBeGreaterThan(0.9)
  })

  it('correlation survives preprocessing and model-ready stages', () => {
    const raw = buildRawDataset(PAIR, '24h', FIXED_NOW)
    const pre = preprocess(raw)
    const model = toModelReady(pre)
    expect(r2(pre)).toBeGreaterThan(0.9)
    expect(r2(model)).toBeGreaterThan(0.9)
  })

  it('drops bad rows in preprocessing', () => {
    const raw = buildRawDataset(PAIR, '24h', FIXED_NOW)
    const pre = preprocess(raw)
    expect(pre.rows.length).toBeLessThanOrEqual(raw.rows.length)
  })

  it('model-ready values are normalized to [0, 1]', () => {
    const model = toModelReady(
      preprocess(buildRawDataset(PAIR, '24h', FIXED_NOW)),
    )
    for (const row of model.rows) {
      for (const t of model.tags) {
        const v = row.cells[t]?.value
        if (v !== undefined) {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

function fixture(): Dataset {
  return {
    tags: ['A', 'B'],
    rows: [
      { timestamp: 't0', cells: { A: { value: 10, status: 'Good' } } },
      { timestamp: 't1', cells: { A: { value: 20, status: 'Bad' } } },
      { timestamp: 't2', cells: { A: { value: 30, status: 'Questionable' } } },
      { timestamp: 't3', cells: { A: { value: 40, status: 'Good' } } },
    ],
  }
}

describe('preprocess — FillStrategy', () => {
  it('default strategies = {} reproduces the prior global drop behaviour', () => {
    const raw = fixture()
    const out = preprocess(raw)
    // t1 (Bad) dropped; t2 (Questionable) interpolated between t0 and t3.
    expect(out.rows.map(r => r.timestamp)).toEqual(['t0', 't2', 't3'])
  })

  it('forward fills Bad/Questionable cells from the nearest prior Good value', () => {
    const strategies: Record<string, FillStrategyConfig> = {
      A: { strategy: 'forward' },
    }
    const out = preprocess(fixture(), strategies)
    expect(out.rows.map(r => r.timestamp)).toEqual(['t0', 't1', 't2', 't3'])
    expect(out.rows[1]?.cells.A?.value).toBe(10)
    expect(out.rows[1]?.cells.A?.status).toBe('Good')
    expect(out.rows[2]?.cells.A?.value).toBe(10)
  })

  it('backward fills Bad/Questionable cells from the nearest next Good value', () => {
    const strategies: Record<string, FillStrategyConfig> = {
      A: { strategy: 'backward' },
    }
    const out = preprocess(fixture(), strategies)
    expect(out.rows[1]?.cells.A?.value).toBe(40)
    expect(out.rows[2]?.cells.A?.value).toBe(40)
  })

  it('mean fills with the average of Good values for that tag', () => {
    const strategies: Record<string, FillStrategyConfig> = {
      A: { strategy: 'mean' },
    }
    const out = preprocess(fixture(), strategies)
    // Good values are 10 and 40 → mean 25.
    expect(out.rows[1]?.cells.A?.value).toBe(25)
    expect(out.rows[2]?.cells.A?.value).toBe(25)
  })

  it('median fills with the median of Good values for that tag', () => {
    const strategies: Record<string, FillStrategyConfig> = {
      A: { strategy: 'median' },
    }
    const out = preprocess(fixture(), strategies)
    expect(out.rows[1]?.cells.A?.value).toBe(25)
  })

  it('constant fills with the configured value', () => {
    const strategies: Record<string, FillStrategyConfig> = {
      A: { strategy: 'constant', constantValue: -1 },
    }
    const out = preprocess(fixture(), strategies)
    expect(out.rows[1]?.cells.A?.value).toBe(-1)
    expect(out.rows[2]?.cells.A?.value).toBe(-1)
  })

  it('explicit drop on a tag removes only rows where that tag is Bad', () => {
    const strategies: Record<string, FillStrategyConfig> = {
      A: { strategy: 'drop' },
    }
    const out = preprocess(fixture(), strategies)
    expect(out.rows.map(r => r.timestamp)).toEqual(['t0', 't2', 't3'])
  })
})

describe('buildRawDataset — constant override', () => {
  it('fills a constant tag with a flat Good series across every row', () => {
    const raw = buildRawDataset(['x'], '24h', FIXED_NOW, { x: 42 })
    expect(raw.rows.length).toBeGreaterThan(0)
    for (const row of raw.rows) {
      expect(row.cells.x?.value).toBe(42)
      expect(row.cells.x?.status).toBe('Good')
    }
  })

  it('ignores constants for tags not in the fetch set', () => {
    const raw = buildRawDataset(['x'], '24h', FIXED_NOW, { y: 99 })
    expect(raw.tags).toEqual(['x'])
    for (const row of raw.rows) {
      expect(row.cells.y).toBeUndefined()
    }
  })

  it('leaves non-constant tags untouched (default empty constants)', () => {
    const withConst = buildRawDataset(PAIR, '24h', FIXED_NOW, {
      [CORRELATED_PAIR.anchor]: 5,
    })
    // Derived tag keeps its correlated (non-constant) values.
    const derivedValues = withConst.rows.map(
      r => r.cells[CORRELATED_PAIR.derived]?.value,
    )
    expect(new Set(derivedValues).size).toBeGreaterThan(1)
    // Anchor is pinned to the constant.
    for (const row of withConst.rows) {
      expect(row.cells[CORRELATED_PAIR.anchor]?.value).toBe(5)
    }
  })
})

describe('datasetStats — droppedRowsByTag', () => {
  it('attributes each dropped row to the Bad tag that caused it', () => {
    const raw = fixture()
    const clean = preprocess(raw)
    const model = toModelReady(clean)
    const stats = datasetStats(raw, clean, model)
    expect(stats.droppedRowsByTag).toEqual({ A: 1 })
  })

  it('omits a tag from droppedRowsByTag once it has a cell-level fill strategy', () => {
    const raw = fixture()
    const strategies: Record<string, FillStrategyConfig> = {
      A: { strategy: 'forward' },
    }
    const clean = preprocess(raw, strategies)
    const model = toModelReady(clean)
    const stats = datasetStats(raw, clean, model, strategies)
    expect(stats.droppedRowsByTag).toEqual({})
    expect(stats.droppedRows).toBe(0)
  })
})
