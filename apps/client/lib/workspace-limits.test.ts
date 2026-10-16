import { describe, it, expect } from 'vitest'
import {
  formatLimit,
  limitReachedNote,
  limitUsage,
  overLimitNote,
  parseLimitInput,
} from './workspace-limits'

describe('workspace limits (MODEL-SERVE-035)', () => {
  it('null and undefined mean no limit', () => {
    expect(limitUsage(null, 50)).toEqual({
      current: 50,
      limit: null,
      full: false,
      over: false,
    })
    expect(limitUsage(undefined, 50).full).toBe(false)
  })

  it('is full at the cap and over above it', () => {
    expect(limitUsage(5, 4)).toMatchObject({ full: false, over: false })
    expect(limitUsage(5, 5)).toMatchObject({ full: true, over: false })
    expect(limitUsage(5, 8)).toMatchObject({ full: true, over: true })
  })

  it('formats 4 / 5, or just 4 with no cap', () => {
    expect(formatLimit(4, 5)).toBe('4 / 5')
    expect(formatLimit(4, null)).toBe('4')
  })

  it('says why Invite is disabled only when full', () => {
    expect(limitReachedNote('members', 5, 4)).toBeNull()
    expect(limitReachedNote('members', 5, 5)).toBe(
      'Member limit reached (5). An admin can raise it.',
    )
  })

  it('notes a cap below the current count, and nothing at or above it', () => {
    expect(overLimitNote('models', 5, 8)).toBe(
      '8 of 5: over the limit. Nothing is removed; new models are blocked until there are fewer than 5.',
    )
    expect(overLimitNote('models', 8, 8)).toBeNull()
    expect(overLimitNote('models', null, 8)).toBeNull()
  })

  it('parses blank as no limit and rejects anything but 1..10000', () => {
    expect(parseLimitInput('')).toBeNull()
    expect(parseLimitInput('  ')).toBeNull()
    expect(parseLimitInput('12')).toBe(12)
    for (const bad of ['0', '-1', '1.5', 'abc', '10001'])
      expect(parseLimitInput(bad)).toBeUndefined()
  })
})
