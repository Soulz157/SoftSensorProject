import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useDatasetFetch } from '../use-dataset-fetch'
import { fetchStateAtom, rawDatasetAtom } from '@/store/data-visualize'

let store: ReturnType<typeof createStore>

beforeEach(() => {
  store = createStore()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function renderFetch() {
  return renderHook(() => useDatasetFetch(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  })
}

describe('useDatasetFetch', () => {
  it('progresses to 100 and writes the raw dataset after the simulated delay', () => {
    const { result } = renderFetch()

    act(() => result.current.start(['TI-101'], '24h'))
    expect(result.current.status).toBe('fetching')
    expect(result.current.progress).toBe(0)

    act(() => vi.advanceTimersByTime(300))
    expect(result.current.status).toBe('fetching')
    expect(result.current.progress).toBe(20)

    act(() => vi.advanceTimersByTime(300 * 4))
    expect(result.current.status).toBe('done')
    expect(result.current.progress).toBe(100)

    const raw = store.get(rawDatasetAtom)
    expect(raw.tags).toEqual(['TI-101'])
    expect(raw.rows.length).toBeGreaterThan(0)
    expect(store.get(fetchStateAtom).status).toBe('done')
  })

  it('errors immediately when no tags are selected', () => {
    const { result } = renderFetch()
    act(() => result.current.start([], '24h'))
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('No tags selected')
  })

  it('retry clears a prior interval and restarts progress from 0', () => {
    const { result } = renderFetch()
    act(() => result.current.start(['tag-1'], '24h'))
    act(() => vi.advanceTimersByTime(300 * 2))
    expect(result.current.progress).toBe(40)

    act(() => result.current.retry(['tag-1'], '24h'))
    expect(result.current.status).toBe('fetching')
    expect(result.current.progress).toBe(0)

    act(() => vi.advanceTimersByTime(300 * 5))
    expect(result.current.status).toBe('done')
  })
})
