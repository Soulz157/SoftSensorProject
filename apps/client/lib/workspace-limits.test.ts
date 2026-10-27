import { describe, it, expect } from 'vitest'
import {
  effectiveLimit,
  formatLimit,
  limitReachedNote,
  limitUsage,
  overLimitNote,
  ownerDisplayName,
  parseLimitInput,
  quotaPercent,
  quotaSourceLabel,
} from './workspace-limits'

describe('workspace quota from the owner plan (MODEL-SERVE-040)', () => {
  it('effectiveLimit: admin override beats plan, plan beats none', () => {
    expect(effectiveLimit(7, 30)).toEqual({ limit: 7, source: 'admin' })
    expect(effectiveLimit(null, 30)).toEqual({ limit: 30, source: 'plan' })
    expect(effectiveLimit(undefined, null)).toEqual({
      limit: null,
      source: 'none',
    })
  })

  it('names where a cap comes from', () => {
    expect(quotaSourceLabel('plan')).toBe("From owner's subscription")
    expect(quotaSourceLabel('admin')).toBe('Set by admin')
    expect(quotaSourceLabel('none')).toBe('No limit')
  })

  it('the reached note points at the owner for a plan cap, an admin otherwise', () => {
    expect(limitReachedNote('members', 3, 3, 'plan')).toBe(
      'Member limit reached (3). The owner can upgrade, or an admin can raise it.',
    )
    expect(limitReachedNote('models', 5, 5)).toBe(
      'Model limit reached (5). An admin can raise it.',
    )
    expect(limitReachedNote('models', 5, 4, 'plan')).toBeNull()
  })

  it('shows the owner by name, never an empty string', () => {
    expect(ownerDisplayName({ firstName: 'Ann', lastName: 'Lee' })).toBe(
      'Ann Lee',
    )
    expect(ownerDisplayName({ firstName: ' Ann ', lastName: null })).toBe('Ann')
    expect(ownerDisplayName({ firstName: null, lastName: null })).toBe(
      'Unknown',
    )
    expect(ownerDisplayName(undefined)).toBe('Unknown')
  })

  it('fills the bar to the cap and caps it at 100', () => {
    expect(quotaPercent({ current: 3, limit: 12 })).toBe(25)
    expect(quotaPercent({ current: 9, limit: 5 })).toBe(100)
    expect(quotaPercent({ current: 4, limit: null })).toBe(0)
    expect(quotaPercent({ current: 4, limit: 0 })).toBe(0)
  })
})

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
