import { describe, expect, it } from 'vitest'
import {
  changePasswordSchema,
  loginSchema,
  newPasswordSchema,
  registerSchema,
  resetRequestSchema,
} from './auth-schemas'

function errors(result: {
  success: boolean
  error?: { issues: { path: PropertyKey[]; message: string }[] }
}) {
  return Object.fromEntries(
    (result.error?.issues ?? []).map(i => [String(i.path[0]), i.message]),
  )
}

describe('auth schemas', () => {
  it('login needs a valid email and a password', () => {
    expect(
      loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success,
    ).toBe(true)
    expect(
      errors(loginSchema.safeParse({ email: 'nope', password: '' })),
    ).toEqual({
      email: 'Enter a valid email address, like name@company.com.',
      password: 'Enter your password.',
    })
  })

  it('register asks for 8+ chars, an uppercase letter and a number — not a symbol', () => {
    const base = {
      firstName: 'Nok',
      lastName: 'S',
      email: 'n@c.co',
      company: 'MOC',
      password: 'Refinery7',
      confirmPassword: 'Refinery7',
    }
    expect(registerSchema.safeParse(base).success).toBe(true)
    expect(
      errors(
        registerSchema.safeParse({
          ...base,
          password: 'refinery7',
          confirmPassword: 'refinery7',
        }),
      ).password,
    ).toBe('Add an uppercase letter.')
    expect(
      errors(
        registerSchema.safeParse({ ...base, confirmPassword: 'Refinery8' }),
      ).confirmPassword,
    ).toBe("Passwords don't match. Type the same password twice.")
    expect(
      errors(registerSchema.safeParse({ ...base, firstName: '  ' })).firstName,
    ).toBe('Enter your first name.')
  })

  it('reset request needs a valid email', () => {
    expect(resetRequestSchema.safeParse({ email: 'x' }).success).toBe(false)
  })

  it('a new password needs all four rules and a matching confirmation', () => {
    expect(
      newPasswordSchema.safeParse({
        password: 'Plant2026!',
        confirmPassword: 'Plant2026!',
      }).success,
    ).toBe(true)
    expect(
      errors(
        newPasswordSchema.safeParse({
          password: 'Plant2026',
          confirmPassword: 'Plant2026',
        }),
      ).password,
    ).toBe('Add a symbol, such as ! or #.')
  })

  it('change password must differ from the current one', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'Plant2026!',
      newPassword: 'Plant2026!',
      confirmPassword: 'Plant2026!',
    })
    expect(errors(r).newPassword).toBe(
      'Choose a password different from your current one.',
    )
  })
})
