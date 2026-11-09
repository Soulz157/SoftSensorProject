import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('next-auth/react', () => ({
  getSession: h.getSession,
  signOut: h.signOut,
}))

import { fetchClient } from './fetcher'

function session(accessToken: string, error?: string) {
  return { user: { accessToken }, error, expires: '' }
}
function res(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status })
}
function authOf(call: unknown[]): string | null {
  return new Headers((call[1] as RequestInit).headers).get('Authorization')
}

/**
 * A 401 must not sign the user out on its own: the access token can expire or
 * be rotated by another request while this one is in flight (a training screen
 * polls every 2.5 s). fetchClient asks for the session again and retries once
 * with a token that actually changed.
 */
describe('fetchClient — one retry on 401 before signing out', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    h.getSession.mockReset()
    h.signOut.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('retries with the refreshed token and returns its result, no sign-out', async () => {
    h.getSession
      .mockResolvedValueOnce(session('old'))
      .mockResolvedValueOnce(session('new'))
    fetchMock
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(200, { data: 'ok' }))

    await expect(fetchClient('/x')).resolves.toEqual({ data: 'ok' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(authOf(fetchMock.mock.calls[0]!)).toBe('Bearer old')
    expect(authOf(fetchMock.mock.calls[1]!)).toBe('Bearer new')
    expect(h.signOut).not.toHaveBeenCalled()
  })

  it('signs out without retrying when the token did not change', async () => {
    h.getSession.mockResolvedValue(session('same'))
    fetchMock.mockResolvedValue(res(401))

    await expect(fetchClient('/x')).rejects.toThrow('Session expired')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(h.signOut).toHaveBeenCalledTimes(1)
  })

  it('signs out without retrying when the refresh itself was refused', async () => {
    h.getSession
      .mockResolvedValueOnce(session('old'))
      .mockResolvedValueOnce(session('new', 'RefreshTokenExpired'))
    fetchMock.mockResolvedValue(res(401))

    await expect(fetchClient('/x')).rejects.toThrow('Session expired')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(h.signOut).toHaveBeenCalledTimes(1)
  })

  it('signs out when the retry is refused too — one retry, never a loop', async () => {
    h.getSession
      .mockResolvedValueOnce(session('old'))
      .mockResolvedValueOnce(session('new'))
    fetchMock.mockResolvedValue(res(401))

    await expect(fetchClient('/x')).rejects.toThrow('Session expired')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(h.signOut).toHaveBeenCalledTimes(1)
  })

  it('re-sends the same method and body on the retry', async () => {
    h.getSession
      .mockResolvedValueOnce(session('old'))
      .mockResolvedValueOnce(session('new'))
    fetchMock
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(200, {}))

    await fetchClient('/x', { method: 'POST', body: '{"a":1}' })

    const retry = fetchMock.mock.calls[1]![1] as RequestInit
    expect(retry.method).toBe('POST')
    expect(retry.body).toBe('{"a":1}')
  })
})
