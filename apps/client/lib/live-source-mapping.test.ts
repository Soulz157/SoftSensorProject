import { describe, expect, it } from 'vitest'
import {
  buildMappingRows,
  effectiveTag,
  filterMappingRows,
  summarizeMapping,
  toColumnTagMap,
} from '@/lib/live-source-mapping'

const rows = (
  map: Record<string, string>,
  found: string[],
  notFound: string[] = [],
) =>
  buildMappingRows({
    columns: ['a', 'b'],
    target: 'y',
    map,
    found: new Set(found),
    notFound: new Set(notFound),
  })

describe('live source mapping (MODEL-SERVE-037-T05)', () => {
  it('a column reads its own name until the user remaps it', () => {
    expect(effectiveTag('a', {})).toBe('a')
    expect(effectiveTag('a', { a: '  ' })).toBe('a')
    expect(effectiveTag('a', { a: ' PI_A.PV ' })).toBe('PI_A.PV')
  })

  it('statuses come from what PI said, never assumed matched', () => {
    const r = rows({ b: 'PI_B.PV' }, ['a'], ['PI_B.PV'])
    expect(r.map(x => [x.column, x.tag, x.status, x.isTarget])).toEqual([
      ['a', 'a', 'matched', false],
      ['b', 'PI_B.PV', 'missing', false],
      ['y', 'y', 'checking', true],
    ])
    expect(r[1]?.remapped).toBe(true)
  })

  it('ready only when every INPUT matches; the target never blocks', () => {
    expect(summarizeMapping(rows({}, ['a'], ['b'])).ready).toBe(false)
    const ok = summarizeMapping(rows({}, ['a', 'b'], ['y']))
    expect(ok).toEqual({ matched: 2, attention: 0, ready: true })
  })

  it('sends every input and the target only when PI knows it', () => {
    expect(toColumnTagMap(rows({ b: 'PI_B.PV' }, ['a', 'PI_B.PV']))).toEqual({
      a: 'a',
      b: 'PI_B.PV',
    })
    expect(
      toColumnTagMap(rows({ y: 'LAB.Y' }, ['a', 'b', 'LAB.Y'])),
    ).toMatchObject({ y: 'LAB.Y' })
  })

  it('filters by status and searches column or tag', () => {
    const r = rows({ b: 'PI_B.PV' }, ['a'], ['PI_B.PV'])
    expect(filterMappingRows(r, 'matched', '').map(x => x.column)).toEqual([
      'a',
    ])
    expect(filterMappingRows(r, 'attention', '').map(x => x.column)).toEqual([
      'b',
      'y',
    ])
    expect(filterMappingRows(r, 'all', 'pi_b').map(x => x.column)).toEqual([
      'b',
    ])
  })
})
