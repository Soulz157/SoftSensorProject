import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const getAll = vi.fn()
const getWorkspace = vi.fn()

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated' }),
}))
vi.mock('@/services/data-intake', () => ({
  dataIntakeService: {
    getAll: (range: unknown) => getAll(range),
    getWorkspace: (id: unknown, range: unknown) => getWorkspace(id, range),
  },
}))

import { useDataIntake } from '../use-data-intake'

const body = { scope: 'all', totals: {}, ingestion: [], workspaces: [] }

beforeEach(() => vi.clearAllMocks())

describe('useDataIntake', () => {
  it('calls the admin endpoint for scope "all" and the workspace one otherwise', async () => {
    getAll.mockResolvedValue({ data: body })
    getWorkspace.mockResolvedValue({ data: { ...body, scope: 'workspace' } })

    const all = renderHook(() => useDataIntake('all', '24h'))
    await waitFor(() => expect(all.result.current.state).toBe('ready'))
    expect(getAll).toHaveBeenCalledWith('24h')

    const one = renderHook(() => useDataIntake('ws1', '7d'))
    await waitFor(() => expect(one.result.current.state).toBe('ready'))
    expect(getWorkspace).toHaveBeenCalledWith('ws1', '7d')
  })

  it('treats a response without `data` as an error, never an empty ready page', async () => {
    // The backend once returned the bare object, so `res.data` was undefined.
    getAll.mockResolvedValue({ scope: 'all' })

    const { result } = renderHook(() => useDataIntake('all', '24h'))
    await waitFor(() => expect(result.current.state).toBe('error'))
    expect(result.current.data).toBeNull()
  })

  it('treats a failed request as an error and drops the old figures', async () => {
    getAll.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useDataIntake('all', '24h'))
    await waitFor(() => expect(result.current.state).toBe('error'))
    expect(result.current.error).toBe("Couldn't load data intake.")
  })

  it('does not fetch while disabled', () => {
    renderHook(() => useDataIntake('ws1', '24h', false))
    expect(getWorkspace).not.toHaveBeenCalled()
  })
})
