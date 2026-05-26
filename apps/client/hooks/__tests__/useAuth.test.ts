import { renderHook } from '@testing-library/react'
import { useSession, signIn } from 'next-auth/react'
import { vi } from 'vitest'
import { useAuth } from '../auth/use-auth'

const mockUseSession = vi.mocked(useSession)
const mockSignIn = vi.mocked(signIn)

describe('useAuth', () => {
  it('returns null user when unauthenticated', () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: 'unauthenticated',
      update: vi.fn(),
    })
    const { result } = renderHook(() => useAuth())
    expect(result.current.user).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('returns user when session is active', () => {
    const fakeUser = {
      id: '1',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'USER',
      accessToken: 'tok',
      refreshToken: 'ref',
    }
    mockUseSession.mockReturnValue({
      data: { user: fakeUser, expires: '' },
      status: 'authenticated',
      update: vi.fn(),
    })
    const { result } = renderHook(() => useAuth())
    expect(result.current.user).toEqual(fakeUser)
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('calls signIn with credentials on login', async () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: 'unauthenticated',
      update: vi.fn(),
    })
    mockSignIn.mockResolvedValue({
      error: null,
      ok: true,
      url: null,
      status: 200,
    } as never)
    const { result } = renderHook(() => useAuth())
    await result.current.login({ email: 'a@b.com', password: 'pass' })
    expect(mockSignIn).toHaveBeenCalledWith('credentials', {
      email: 'a@b.com',
      password: 'pass',
      redirect: false,
    })
  })
})
