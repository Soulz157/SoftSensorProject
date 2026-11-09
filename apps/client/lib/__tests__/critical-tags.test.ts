import { describe, expect, it } from 'vitest'
import {
  isCriticalTag,
  renameCriticalTag,
  suggestRangeAction,
  toggleCriticalTag,
  withoutCriticalTags,
} from '@/lib/critical-tags'

describe('suggestRangeAction', () => {
  it('suggests Clip for a critical tag and Exclude for any other', () => {
    expect(suggestRangeAction('FI-1', ['FI-1']).action).toBe('clip')
    expect(suggestRangeAction('TI-2', ['FI-1']).action).toBe('exclude')
    expect(suggestRangeAction('TI-2', []).action).toBe('exclude')
  })

  it('gives a reason for either suggestion', () => {
    expect(suggestRangeAction('FI-1', ['FI-1']).reason).toMatch(/^Critical tag/)
    expect(suggestRangeAction('TI-2', []).reason).toMatch(/^Not a critical tag/)
  })
})

describe('critical-tag list helpers', () => {
  it('toggles a tag in and out, keeping order', () => {
    expect(toggleCriticalTag(['A'], 'B')).toEqual(['A', 'B'])
    expect(toggleCriticalTag(['A', 'B'], 'A')).toEqual(['B'])
    expect(isCriticalTag('B', ['A', 'B'])).toBe(true)
  })

  it('follows a rename, and ignores a tag that is not critical', () => {
    expect(renameCriticalTag(['A', 'B'], 'A', 'A2')).toEqual(['A2', 'B'])
    expect(renameCriticalTag(['A'], 'X', 'Y')).toEqual(['A'])
    // Renaming onto a name already in the list does not duplicate it.
    expect(renameCriticalTag(['A', 'B'], 'A', 'B')).toEqual(['B'])
  })

  it('drops deleted names or the new target', () => {
    expect(withoutCriticalTags(['A', 'B', 'C'], ['A', 'C'])).toEqual(['B'])
    expect(withoutCriticalTags(['A'], [])).toEqual(['A'])
  })
})
