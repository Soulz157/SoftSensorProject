import { describe, expect, it } from 'vitest'
import type { Workspace } from '@/types'
import { canViewScope, workspacesInScope } from './pipeline-metrics'

function ws(id: string): Workspace {
  return {
    id,
    ownerId: 'u1',
    name: `Workspace ${id}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    _count: { members: 1, models: 0 },
    status: 'normal',
  }
}

// What the backend returns for a non-admin: only their member workspaces.
const MINE = [ws('a'), ws('b')]

describe('workspacesInScope', () => {
  it('returns every workspace for the all-workspaces scope', () => {
    expect(workspacesInScope('all', MINE).map(w => w.id)).toEqual(['a', 'b'])
  })

  it("returns only the named workspace, never the user's others", () => {
    expect(workspacesInScope('b', MINE).map(w => w.id)).toEqual(['b'])
  })

  it('returns nothing for a workspace the user is not a member of', () => {
    expect(workspacesInScope('z', MINE)).toEqual([])
  })
})

describe('canViewScope', () => {
  it('allows the all-workspaces scope (its route is admin-guarded)', () => {
    expect(canViewScope('all', MINE)).toBe(true)
  })

  it('allows a member workspace', () => {
    expect(canViewScope('a', MINE)).toBe(true)
  })

  it('refuses a workspace missing from the viewer list', () => {
    expect(canViewScope('z', MINE)).toBe(false)
  })
})
