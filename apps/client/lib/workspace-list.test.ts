import { describe, expect, it } from 'vitest'
import {
  filterWorkspaces,
  noMatchMessage,
  paginate,
  resolveWorkspaceFilter,
  sortForAttention,
  summarizeWorkspaces,
  toWorkspaceListItems,
  workspaceStatus,
  type WorkspaceListItem,
} from './workspace-list'

function ws(over: Partial<WorkspaceListItem> = {}): WorkspaceListItem {
  return {
    id: 'w',
    name: 'Mock Unit',
    status: 'normal',
    abnormalModels: 0,
    modelsCount: 1,
    plantsCount: 1,
    datasetsCount: 1,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

describe('workspaceStatus', () => {
  it('is abnormal for an alarm node, or for any abnormal model', () => {
    expect(workspaceStatus(ws({ status: 'alarm' }))).toBe('abnormal')
    expect(workspaceStatus(ws({ abnormalModels: 2 }))).toBe('abnormal')
  })

  it('treats warning and offline nodes as normal, like the sidebar', () => {
    expect(workspaceStatus(ws({ status: 'warning' }))).toBe('normal')
    expect(workspaceStatus(ws({ status: 'offline' }))).toBe('normal')
  })
})

describe('filterWorkspaces', () => {
  const list = [
    ws({ id: '1', name: 'Alpha Line', description: 'Cracker' }),
    ws({ id: '2', name: 'Beta Unit', status: 'alarm' }),
    ws({ id: '3', name: 'Gamma', abnormalModels: 1 }),
  ]

  it('searches name and description, ignoring case and padding', () => {
    expect(
      filterWorkspaces(list, { query: '  ALPHA ' }).map(w => w.id),
    ).toEqual(['1'])
    expect(filterWorkspaces(list, { query: 'cracker' }).map(w => w.id)).toEqual(
      ['1'],
    )
  })

  it('filters by status', () => {
    expect(
      filterWorkspaces(list, { status: 'attention' }).map(w => w.id),
    ).toEqual(['2', '3'])
    expect(filterWorkspaces(list, { status: 'normal' }).map(w => w.id)).toEqual(
      ['1'],
    )
    expect(filterWorkspaces(list, { status: 'all' })).toHaveLength(3)
  })

  it('combines search and status', () => {
    expect(
      filterWorkspaces(list, { query: 'gamma', status: 'normal' }),
    ).toEqual([])
  })
})

describe('sortForAttention', () => {
  it('puts abnormal first, then sorts by name, without mutating the input', () => {
    const list = [
      ws({ id: 'b', name: 'B' }),
      ws({ id: 'z', name: 'Z', abnormalModels: 1 }),
      ws({ id: 'a', name: 'A' }),
      ws({ id: 'm', name: 'M', status: 'alarm' }),
    ]
    expect(sortForAttention(list).map(w => w.id)).toEqual(['m', 'z', 'a', 'b'])
    expect(list.map(w => w.id)).toEqual(['b', 'z', 'a', 'm'])
  })
})

describe('while model counts are unknown', () => {
  const loading = [
    ws({ id: 'c', name: 'C', abnormalModels: null }),
    ws({ id: 'a', name: 'A', abnormalModels: null }),
    ws({ id: 'z', name: 'Z', abnormalModels: null, status: 'alarm' }),
  ]

  it('is unknown, unless an alerting node already makes it abnormal', () => {
    expect(workspaceStatus(loading[0]!)).toBe('unknown')
    expect(workspaceStatus(loading[2]!)).toBe('abnormal')
  })

  it('sorts by name with alerting nodes first, so the first paint is stable', () => {
    expect(sortForAttention(loading).map(w => w.id)).toEqual(['z', 'a', 'c'])
  })

  it('only moves model-abnormal workspaces once the counts arrive', () => {
    const loaded = loading.map(w => ({
      ...w,
      abnormalModels: w.id === 'c' ? 1 : 0,
    }))
    // 'a' and 'z' keep their relative order; only 'c' moves up.
    expect(sortForAttention(loaded).map(w => w.id)).toEqual(['c', 'z', 'a'])
  })

  it('puts unknown workspaces in neither the attention nor the normal filter', () => {
    expect(
      filterWorkspaces(loading, { status: 'attention' }).map(w => w.id),
    ).toEqual(['z'])
    expect(filterWorkspaces(loading, { status: 'normal' })).toEqual([])
    expect(filterWorkspaces(loading, { status: 'all' })).toHaveLength(3)
  })
})

describe('toWorkspaceListItems', () => {
  const payload = [
    {
      id: 'w1',
      name: 'One',
      status: 'normal' as const,
      modelsCount: 2,
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'w2',
      name: 'Two',
      status: 'alarm' as const,
      modelsCount: undefined,
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  ]

  it('marks every abnormal count unknown while models have not loaded', () => {
    expect(
      toWorkspaceListItems(payload, null).map(w => w.abnormalModels),
    ).toEqual([null, null])
  })

  it('joins abnormal counts by workspace, 0 when a workspace has none', () => {
    const items = toWorkspaceListItems(payload, { w2: 3 })
    expect(items.map(w => w.abnormalModels)).toEqual([0, 3])
    // An absent count stays absent — never coerced to 0.
    expect(items[1]!.modelsCount).toBeUndefined()
  })
})

describe('summarizeWorkspaces', () => {
  it('counts attention and normal, and sums models', () => {
    const s = summarizeWorkspaces([
      ws({ modelsCount: 3 }),
      ws({ modelsCount: 4, abnormalModels: 1 }),
    ])
    expect(s).toEqual({ total: 2, attention: 1, normal: 1, models: 7 })
  })

  it('reports attention as unknown while any abnormal count is unknown', () => {
    const s = summarizeWorkspaces([
      ws({ abnormalModels: 1 }),
      ws({ abnormalModels: null }),
    ])
    expect(s.attention).toBeNull()
    expect(s.normal).toBeNull()
    expect(s.total).toBe(2)
  })

  it('reports an unknown total as null, never as a partial sum', () => {
    const s = summarizeWorkspaces([
      ws({ modelsCount: 3 }),
      ws({ modelsCount: undefined }),
    ])
    expect(s.models).toBeNull()
    expect(summarizeWorkspaces([ws({ modelsCount: null })]).models).toBeNull()
  })

  it('reports a genuine zero as 0, and an empty list as 0 models', () => {
    expect(summarizeWorkspaces([ws({ modelsCount: 0 })]).models).toBe(0)
    expect(summarizeWorkspaces([]).models).toBe(0)
  })
})

describe('paginate', () => {
  const nums = Array.from({ length: 50 }, (_, i) => i + 1)

  it('slices 15 per page by default and reports the range', () => {
    const p = paginate(nums, 1)
    expect(p.items).toHaveLength(15)
    expect(p).toMatchObject({
      page: 1,
      pageCount: 4,
      from: 1,
      to: 15,
      total: 50,
    })
    const last = paginate(nums, 4)
    expect(last.items).toEqual([46, 47, 48, 49, 50])
    expect(last).toMatchObject({ from: 46, to: 50 })
  })

  it('has exactly one page at the boundary and two just past it', () => {
    expect(paginate(nums.slice(0, 15), 1).pageCount).toBe(1)
    expect(paginate(nums.slice(0, 16), 1).pageCount).toBe(2)
  })

  it('clamps an out-of-range or invalid page', () => {
    expect(paginate(nums, 99).page).toBe(4)
    expect(paginate(nums, 0).page).toBe(1)
    expect(paginate(nums, Number.NaN).page).toBe(1)
  })

  it('handles an empty list without a negative range', () => {
    expect(paginate([], 1)).toMatchObject({
      items: [],
      page: 1,
      pageCount: 1,
      from: 0,
      to: 0,
      total: 0,
    })
  })
})

describe('resolveWorkspaceFilter', () => {
  const mine = [{ id: 'a' }, { id: 'b' }]

  it('keeps an id the user has', () => {
    expect(resolveWorkspaceFilter('b', mine)).toBe('b')
  })

  it('falls back to All for an unknown id, instead of an empty table', () => {
    expect(resolveWorkspaceFilter('zzz', mine)).toBe('')
  })

  it('trusts the id while the workspace list has not loaded', () => {
    expect(resolveWorkspaceFilter('b', [])).toBe('b')
  })

  it('treats no request as All', () => {
    expect(resolveWorkspaceFilter('', mine)).toBe('')
  })
})

describe('noMatchMessage', () => {
  it('blames the search only when there is one', () => {
    expect(noMatchMessage('pump', 'attention')).toMatch(/matches your search/)
    expect(noMatchMessage('   ', 'attention')).toBe(
      'No workspace needs attention.',
    )
  })

  it('reads a filter-only empty result as what it is', () => {
    expect(noMatchMessage('', 'attention')).toBe(
      'No workspace needs attention.',
    )
    expect(noMatchMessage('', 'normal')).toMatch(
      /No workspace is reading Normal/,
    )
  })
})
