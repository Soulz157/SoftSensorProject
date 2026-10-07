import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const replace = vi.fn()
let search = ''

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/models/views',
  useSearchParams: () => new URLSearchParams(search),
}))

import { useWorkspaceUrlFilter } from '../use-workspace-url-filter'

const mine = [{ id: 'a' }, { id: 'b' }]

describe('useWorkspaceUrlFilter', () => {
  beforeEach(() => {
    replace.mockClear()
    search = ''
  })

  it('starts from ?workspace=', () => {
    search = 'workspace=b'
    const { result } = renderHook(() => useWorkspaceUrlFilter(mine))
    expect(result.current.workspaceId).toBe('b')
  })

  it('falls back to All for an id the user does not have', () => {
    search = 'workspace=zzz'
    const { result } = renderHook(() => useWorkspaceUrlFilter(mine))
    expect(result.current.workspaceId).toBe('')
  })

  it('follows the URL when only the param changes on a mounted page', () => {
    search = 'workspace=a'
    const { result, rerender } = renderHook(() => useWorkspaceUrlFilter(mine))
    expect(result.current.workspaceId).toBe('a')

    search = 'workspace=b'
    rerender()
    expect(result.current.workspaceId).toBe('b')

    // The sidebar's plain /models/views link: back to All.
    search = ''
    rerender()
    expect(result.current.workspaceId).toBe('')
  })

  it('writes the choice to the URL, keeping other params', () => {
    search = 'workspace=a&tab=x'
    const { result } = renderHook(() => useWorkspaceUrlFilter(mine))
    act(() => result.current.selectWorkspace('b'))
    expect(result.current.workspaceId).toBe('b')
    expect(replace).toHaveBeenCalledWith('/models/views?workspace=b&tab=x', {
      scroll: false,
    })
  })

  it('drops the param when the user picks All', () => {
    search = 'workspace=a'
    const { result } = renderHook(() => useWorkspaceUrlFilter(mine))
    act(() => result.current.selectWorkspace(''))
    expect(result.current.workspaceId).toBe('')
    expect(replace).toHaveBeenCalledWith('/models/views', { scroll: false })
  })

  it('keeps the choice while the URL update is still in flight', () => {
    search = 'workspace=a'
    const { result, rerender } = renderHook(() => useWorkspaceUrlFilter(mine))
    act(() => result.current.selectWorkspace('b'))
    rerender() // URL not updated yet: still workspace=a
    expect(result.current.workspaceId).toBe('b')
    search = 'workspace=b' // the replace lands
    rerender()
    expect(result.current.workspaceId).toBe('b')
  })
})
