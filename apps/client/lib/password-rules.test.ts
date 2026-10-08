import { describe, expect, it } from 'vitest'
import {
  checkPassword,
  firstPasswordProblem,
  REGISTER_RULE_IDS,
} from './password-rules'

describe('password rules', () => {
  it('checks the 8-character boundary', () => {
    expect(checkPassword('Abcdef1!')[0]?.met).toBe(true)
    expect(checkPassword('Abcde1!')[0]?.met).toBe(false)
  })

  it('marks each rule independently', () => {
    expect(checkPassword('abcdefgh').map(c => c.met)).toEqual([
      true,
      false,
      false,
      false,
    ])
    expect(checkPassword('Abcdefg1#').every(c => c.met)).toBe(true)
  })

  it('register asks for three rules, not the symbol', () => {
    const checks = checkPassword('Abcdefg1', REGISTER_RULE_IDS)
    expect(checks.map(c => c.id)).toEqual(['length', 'upper', 'number'])
    expect(firstPasswordProblem('Abcdefg1', REGISTER_RULE_IDS)).toBeNull()
  })

  it('returns the first failing rule as a fix-it sentence', () => {
    expect(firstPasswordProblem('abc')).toBe('Use at least 8 characters.')
    expect(firstPasswordProblem('abcdefgh')).toBe('Add an uppercase letter.')
    expect(firstPasswordProblem('Abcdefg1')).toBe(
      'Add a symbol, such as ! or #.',
    )
  })
})
