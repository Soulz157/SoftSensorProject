import { describe, expect, it } from 'vitest'
import { describeRelink, sourceLabel } from '@/lib/model-data-source'
import type { ScheduleSourceRef } from '@/services/inference-window'

const src = (over: Partial<ScheduleSourceRef> = {}): ScheduleSourceRef => ({
  id: 'src-a',
  name: 'PI North',
  type: 'aveva',
  status: 'connected',
  ...over,
})

describe('describeRelink (MODEL-SERVE-013-T04)', () => {
  it('a model that was never deployed cannot relink', () => {
    // `InferenceSchedule.sourceId` is required on the row, so a null
    // `currentSource` means no binding has ever existed — there is nothing
    // to re-point, and the server's write path is a no-op by design.
    const v = describeRelink({ currentSource: null, sourceCandidates: [src()] })
    expect(v.state).toBe('no-schedule')
    expect(v.canRelink).toBe(false)
  })

  it('a bound source whose row is gone KEEPS the picker — relinking is the repair', () => {
    const v = describeRelink({
      currentSource: src({ name: null, type: null, status: 'missing' }),
      sourceCandidates: [src({ id: 'src-b', name: 'PI South' })],
    })
    expect(v.state).toBe('missing-source')
    expect(v.canRelink).toBe(true)
  })

  it('a missing source with no candidates has nothing to repair with', () => {
    const v = describeRelink({
      currentSource: src({ name: null, status: 'missing' }),
      sourceCandidates: [],
    })
    expect(v.canRelink).toBe(false)
  })

  it('no candidates (nothing in production) is read-only, never a picker', () => {
    // Offering a choice the server would refuse is worse than offering none:
    // the legal set comes from the PINNED version's dataset, and there is no
    // pinned version here.
    const v = describeRelink({ currentSource: src(), sourceCandidates: [] })
    expect(v.state).toBe('no-candidates')
    expect(v.canRelink).toBe(false)
  })

  it('a single-source dataset shows the name but offers no choice', () => {
    const v = describeRelink({
      currentSource: src(),
      sourceCandidates: [src()],
    })
    expect(v.state).toBe('single-source')
    expect(v.canRelink).toBe(false)
  })

  it('two or more candidates is the only selectable state', () => {
    const v = describeRelink({
      currentSource: src(),
      sourceCandidates: [src(), src({ id: 'src-b', name: 'PI South' })],
    })
    expect(v.state).toBe('selectable')
    expect(v.canRelink).toBe(true)
  })

  it('every state explains itself', () => {
    // A missing picker with no sentence beside it reads as a bug.
    for (const v of [
      describeRelink({ currentSource: null, sourceCandidates: [] }),
      describeRelink({ currentSource: src(), sourceCandidates: [] }),
      describeRelink({ currentSource: src(), sourceCandidates: [src()] }),
    ]) {
      expect(v.note.length).toBeGreaterThan(0)
    }
  })
})

describe('sourceLabel', () => {
  it('falls back to the raw id rather than an empty label', () => {
    expect(sourceLabel(src({ name: null, status: 'missing' }))).toBe(
      'Unknown source (src-a)',
    )
  })

  it('prints the name when there is one', () => {
    expect(sourceLabel(src())).toBe('PI North')
  })
})
