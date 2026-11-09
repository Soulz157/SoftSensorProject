import { describe, it, expect } from 'vitest'
import { TAG_CHIP_LIMIT, visibleTagChips } from '@/lib/tag-chips'

const tags = (n: number) => Array.from({ length: n }, (_, i) => `TAG-${i + 1}`)

describe('visibleTagChips', () => {
  it('shows 12 by default — inside the 10-15 the user asked for', () => {
    expect(TAG_CHIP_LIMIT).toBeGreaterThanOrEqual(10)
    expect(TAG_CHIP_LIMIT).toBeLessThanOrEqual(15)
  })

  it('cuts a long list to the limit and counts what is left', () => {
    const r = visibleTagChips(tags(40), [], false)
    expect(r.visible).toEqual(tags(TAG_CHIP_LIMIT))
    expect(r.hiddenCount).toBe(40 - TAG_CHIP_LIMIT)
    expect(r.collapsible).toBe(true)
  })

  it('shows everything once expanded, and stays collapsible so it can fold back', () => {
    const r = visibleTagChips(tags(40), [], true)
    expect(r.visible).toEqual(tags(40))
    expect(r.hiddenCount).toBe(0)
    expect(r.collapsible).toBe(true)
  })

  it('offers no Show more when everything already fits', () => {
    for (const n of [0, 1, TAG_CHIP_LIMIT]) {
      const r = visibleTagChips(tags(n), [], false)
      expect(r.visible).toEqual(tags(n))
      expect(r.hiddenCount).toBe(0)
      expect(r.collapsible).toBe(false)
    }
  })

  it('offers it for exactly one tag over the limit', () => {
    const r = visibleTagChips(tags(TAG_CHIP_LIMIT + 1), [], false)
    expect(r.hiddenCount).toBe(1)
    expect(r.collapsible).toBe(true)
  })

  it('never hides a tag that is switched on, and keeps the order', () => {
    const all = tags(40)
    const r = visibleTagChips(all, ['TAG-30', 'TAG-2'], false)
    expect(r.visible).toEqual([...tags(TAG_CHIP_LIMIT), 'TAG-30'])
    expect(r.hiddenCount).toBe(40 - TAG_CHIP_LIMIT - 1)
  })

  it('does not double-count an active tag that is already in the first page', () => {
    const r = visibleTagChips(tags(40), ['TAG-3'], false)
    expect(r.visible).toEqual(tags(TAG_CHIP_LIMIT))
    expect(r.hiddenCount).toBe(40 - TAG_CHIP_LIMIT)
  })

  it('ignores an active tag that is not in the list', () => {
    const r = visibleTagChips(tags(40), ['GONE'], false)
    expect(r.visible).toEqual(tags(TAG_CHIP_LIMIT))
  })

  it('takes a custom limit and does not mutate its input', () => {
    const all = tags(10)
    const copy = [...all]
    expect(visibleTagChips(all, [], false, 4).visible).toEqual(tags(4))
    expect(all).toEqual(copy)
  })
})
