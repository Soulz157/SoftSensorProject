import { describe, expect, it } from 'vitest'
import { loginUrlWithCallback, safeCallbackUrl } from './safe-callback-url'

describe('safeCallbackUrl (DS-LAKE-037-D05)', () => {
  it('accepts a same-origin relative path, query included', () => {
    expect(safeCallbackUrl('/data-studio/create?draftId=abc')).toBe(
      '/data-studio/create?draftId=abc',
    )
    expect(safeCallbackUrl('/overview')).toBe('/overview')
  })

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'data-studio/create',
    '',
    '/ok\nhttps://evil',
    '/a\\b',
  ])('rejects %j', raw => {
    expect(safeCallbackUrl(raw)).toBeNull()
  })

  it('rejects null/undefined', () => {
    expect(safeCallbackUrl(null)).toBeNull()
    expect(safeCallbackUrl(undefined)).toBeNull()
  })

  it('refuses auth pages so a login cannot bounce back to /login', () => {
    expect(safeCallbackUrl('/auth/login')).toBeNull()
    expect(safeCallbackUrl('/auth/login?x=1')).toBeNull()
    expect(safeCallbackUrl('/auth/reset-password/token')).toBeNull()
    expect(safeCallbackUrl('/loginfoo')).toBe('/loginfoo')
  })
})

describe('loginUrlWithCallback', () => {
  it('encodes the path so its own query survives', () => {
    expect(loginUrlWithCallback('/data-studio/create?draftId=a&x=1')).toBe(
      '/auth/login?callbackUrl=%2Fdata-studio%2Fcreate%3FdraftId%3Da%26x%3D1',
    )
  })

  it('falls back to a bare /login for an auth page or junk', () => {
    expect(loginUrlWithCallback('/auth/login')).toBe('/auth/login')
    expect(loginUrlWithCallback('https://evil')).toBe('/auth/login')
  })
})
