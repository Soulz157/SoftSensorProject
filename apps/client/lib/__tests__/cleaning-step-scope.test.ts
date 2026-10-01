import { describe, expect, it } from 'vitest'
import {
  inStepWindow,
  patchCleaningStep,
  preprocessPipelines,
  type CleaningStep,
  type Dataset,
} from '../preprocessing'

/** DS-LAKE-032-T01 / V01 — per-step tag scope and the clip/crop/exclude
 * time window, in the browser engine. */

const STAMPS = [
  '2026-01-01 00:00:00',
  '2026-01-01 06:00:00',
  '2026-01-01 12:00:00',
  '2026-01-01 18:00:00',
]

function dataset(values: Record<string, number[]>): Dataset {
  const tags = Object.keys(values)
  return {
    tags,
    rows: STAMPS.map((timestamp, i) => ({
      timestamp,
      cells: Object.fromEntries(
        tags.map(t => [t, { value: values[t]![i]!, status: 'Good' as const }]),
      ),
    })),
  }
}

function step(partial: Partial<CleaningStep>): CleaningStep {
  return { uid: 'u', category: 'outliers', method: 'clip', ...partial }
}

const col = (ds: Dataset, tag: string) => ds.rows.map(r => r.cells[tag]!.value)

describe('inStepWindow', () => {
  it('is always inside with no window', () => {
    expect(inStepWindow('2026-01-01 06:00:00', {})).toBe(true)
  })

  it('is inclusive at both ends, the end through its whole minute', () => {
    const w = { startTime: '2026-01-01T06:00', endTime: '2026-01-01T12:00' }
    expect(inStepWindow('2026-01-01 05:59:59', w)).toBe(false)
    expect(inStepWindow('2026-01-01 06:00:00', w)).toBe(true)
    expect(inStepWindow('2026-01-01 12:00:59.5', w)).toBe(true)
    expect(inStepWindow('2026-01-01 12:01:00', w)).toBe(false)
  })

  it('reads an offset-suffixed timestamp on the Bangkok wall clock', () => {
    // 23:00Z on Dec 31 is 06:00 on Jan 1 in Bangkok.
    const w = { startTime: '2026-01-01T06:00', endTime: '2026-01-01T06:00' }
    expect(inStepWindow('2025-12-31T23:00:00.000Z', w)).toBe(true)
  })
})

describe('preprocessPipelines — window', () => {
  const ds = dataset({ T: [10, 50, 90, 130] })
  const window = { startTime: '2026-01-01T06:00', endTime: '2026-01-01T12:00' }

  it('clips only inside the window', () => {
    const out = preprocessPipelines(ds, {
      T: [step({ method: 'clip', paramLow: 60, param: 80, ...window })],
    })
    expect(col(out, 'T')).toEqual([10, 60, 80, 130])
  })

  it('crops only inside the window — rows outside it are never dropped', () => {
    const out = preprocessPipelines(ds, {
      T: [step({ method: 'crop', paramLow: 40, param: 60, ...window })],
    })
    expect(col(out, 'T')).toEqual([10, 50, 130])
  })

  it('excludes only inside the window', () => {
    const out = preprocessPipelines(ds, {
      T: [step({ method: 'exclude', paramLow: 0, param: 200, ...window })],
    })
    expect(out.rows.map(r => r.cells.T!.status)).toEqual([
      'Good',
      'Bad',
      'Bad',
      'Good',
    ])
  })

  it('is unchanged without a window', () => {
    const out = preprocessPipelines(ds, {
      T: [step({ method: 'clip', paramLow: 60, param: 80 })],
    })
    expect(col(out, 'T')).toEqual([60, 60, 80, 80])
  })
})

describe('preprocessPipelines — tag scope', () => {
  const ds = dataset({ A: [10, 50, 90, 130], B: [10, 50, 90, 130] })

  it('skips a step for a tag outside its scope', () => {
    const s = step({ method: 'clip', paramLow: 60, param: 80, tags: ['A'] })
    const out = preprocessPipelines(ds, { A: [s], B: [s] })
    expect(col(out, 'A')).toEqual([60, 60, 80, 80])
    expect(col(out, 'B')).toEqual([10, 50, 90, 130])
  })

  it('applies to every tag when the scope is absent', () => {
    const s = step({ method: 'clip', paramLow: 60, param: 80 })
    const out = preprocessPipelines(ds, { A: [s], B: [s] })
    expect(col(out, 'B')).toEqual([60, 60, 80, 80])
  })
})

describe('patchCleaningStep', () => {
  const base = step({ method: 'clip', param: 5 })

  it('a cleared scope serialises exactly like a step that never had one', () => {
    const scoped = patchCleaningStep(base, { tags: ['A'] })
    const cleared = patchCleaningStep(scoped, { tags: undefined })
    expect('tags' in cleared).toBe(false)
    expect(JSON.stringify(cleared)).toBe(JSON.stringify(base))
  })

  it('clearing the window removes both ends and keeps everything else', () => {
    const windowed = patchCleaningStep(base, {
      startTime: '2026-01-01T06:00',
      endTime: '2026-01-01T12:00',
    })
    const cleared = patchCleaningStep(windowed, {
      startTime: undefined,
      endTime: undefined,
    })
    expect(cleared).toEqual(base)
    expect(JSON.stringify(cleared)).toBe(JSON.stringify(base))
  })
})
