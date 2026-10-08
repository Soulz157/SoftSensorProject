import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated' }),
}))

import { usePaginatedFetch } from '../use-paginated-fetch'

const page = (tag: string) => ({
  data: { items: [tag], total: 1, page: 1, limit: 15, totalPages: 1 },
})

/** A promise the test settles by hand, to force response ordering. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('usePaginatedFetch', () => {
  beforeEach(() => toastError.mockReset())

  it('drops a slower, older response so it cannot overwrite the newer one', async () => {
    const first = deferred<ReturnType<typeof page>>()
    const second = deferred<ReturnType<typeof page>>()
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const { result, rerender } = renderHook(
      ({ p }) => usePaginatedFetch<string>(fetcher, [p], 'Failed'),
      { initialProps: { p: 1 } },
    )
    rerender({ p: 2 })
    await act(async () => second.resolve(page('page 2')))
    await act(async () => first.resolve(page('page 1')))

    expect(result.current.data?.items).toEqual(['page 2'])
    expect(result.current.isFetching).toBe(false)
  })

  it('a stale failure neither sets the error nor toasts', async () => {
    const first = deferred<ReturnType<typeof page>>()
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(page('fresh'))

    const { result } = renderHook(() =>
      usePaginatedFetch<string>(fetcher, [], 'Failed'),
    )
    // A retry supersedes the first request before it fails.
    await act(async () => {
      await result.current.refetch()
    })
    await act(async () => first.reject(new Error('late')))

    expect(result.current.data?.items).toEqual(['fresh'])
    expect(result.current.error).toBeNull()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('toasts by default, but not with notifyOnError: false', async () => {
    const fail = () => vi.fn().mockRejectedValue(new Error('x'))

    const loud = renderHook(() => usePaginatedFetch(fail(), [], 'Failed A'))
    await waitFor(() => expect(loud.result.current.error).toBe('Failed A'))
    expect(toastError).toHaveBeenCalledWith('Failed A')

    toastError.mockReset()
    const quiet = renderHook(() =>
      usePaginatedFetch(fail(), [], 'Failed B', { notifyOnError: false }),
    )
    await waitFor(() => expect(quiet.result.current.error).toBe('Failed B'))
    expect(toastError).not.toHaveBeenCalled()
  })
})
