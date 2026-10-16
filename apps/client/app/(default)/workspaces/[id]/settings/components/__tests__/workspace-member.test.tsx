import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WorkspaceMember, WorkspacePermission } from '@/types'

/**
 * MODEL-SERVE-034. Who sees the member menu and Invite. A STAFF member sees
 * the ⋯ menu only when an owner granted "Assign roles", and then only on
 * other, non-owner rows, without Remove. Invite needs "Invite members".
 */

const h = vi.hoisted(() => ({
  members: [] as WorkspaceMember[],
  isOwner: false,
  currentUserId: 'u-me',
  maxMembers: null as number | null,
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: h.currentUserId } } }),
}))

vi.mock('@/hooks/workspace/use-workspace-members', () => ({
  useWorkspaceMembers: () => ({
    members: h.members,
    loading: false,
    isFetching: false,
    isOwner: h.isOwner,
    currentMember: h.members.find(m => m.userId === h.currentUserId) ?? null,
    fetchMembers: vi.fn(),
  }),
}))

vi.mock('@/hooks/workspace/use-workspace-by', () => ({
  useWorkspace: () => ({ workspace: { maxMembers: h.maxMembers } }),
}))

vi.mock('@/services/workspace', () => ({ workspaceService: {} }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { WorkspaceMembers } from '../workspace-member'

function member(
  userId: string,
  firstName: string,
  role: WorkspaceMember['role'],
  permissions: WorkspacePermission[] = [],
): WorkspaceMember {
  return {
    id: `m-${userId}`,
    userId,
    role,
    permissions,
    createdAt: '2026-10-15T00:00:00.000Z',
    user: { id: userId, firstName, lastName: null, email: `${userId}@x.test` },
  }
}

const others = [
  member('u-own', 'Olivia', 'OWNER'),
  member('u-stf', 'Sam', 'STAFF'),
  member('u-vw', 'Vic', 'VIEWER'),
]

function setup(me: WorkspaceMember, isOwner = false) {
  h.members = [me, ...others]
  h.isOwner = isOwner
  render(<WorkspaceMembers workspaceId="ws-1" />)
}

const menuFor = (name: string) =>
  screen.queryByRole('button', { name: `Actions for ${name}` })

describe('WorkspaceMembers — member management access', () => {
  beforeEach(() => {
    h.members = []
    h.maxMembers = null
  })

  it('a STAFF without grants sees no menu and no Invite', () => {
    setup(member('u-me', 'Me', 'STAFF'))
    for (const name of ['Olivia', 'Sam', 'Vic', 'Me'])
      expect(menuFor(name)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()
  })

  it('a STAFF with "Assign roles" gets the menu on other non-owner rows only', () => {
    setup(member('u-me', 'Me', 'STAFF', ['MEMBER_ROLE_ASSIGN']))
    expect(menuFor('Sam')).not.toBeNull()
    expect(menuFor('Vic')).not.toBeNull()
    expect(menuFor('Olivia')).toBeNull()
    expect(menuFor('Me')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()
  })

  it("a delegate's menu has Manage access but no Remove", async () => {
    setup(member('u-me', 'Me', 'STAFF', ['MEMBER_ROLE_ASSIGN']))
    await userEvent.click(menuFor('Vic')!)
    expect(
      screen.getByRole('menuitem', { name: 'Manage access…' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).toBeNull()
  })

  it('a STAFF with "Invite members" sees Invite, without Owner in the role list', async () => {
    setup(member('u-me', 'Me', 'STAFF', ['MEMBER_INVITE']))
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }))
    const options = screen
      .getAllByRole('option')
      .map(o => (o as HTMLOptionElement).value)
    expect(options).toEqual(['VIEWER', 'STAFF'])
  })

  it('an owner keeps the menu on every row, with Remove', async () => {
    setup(member('u-me', 'Me', 'OWNER'), true)
    for (const name of ['Olivia', 'Sam', 'Vic', 'Me'])
      expect(menuFor(name)).not.toBeNull()
    await userEvent.click(menuFor('Vic')!)
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeInTheDocument()
  })
})

/** MODEL-SERVE-035. The admin-set member cap, as members see it. */
describe('WorkspaceMembers — member limit', () => {
  beforeEach(() => {
    h.maxMembers = null
  })

  it('shows the count against the cap', () => {
    h.maxMembers = 5
    setup(member('u-me', 'Me', 'OWNER'), true)
    expect(screen.getByText('4 / 5')).toBeInTheDocument()
  })

  it('disables Invite with the reason when the workspace is full', () => {
    h.maxMembers = 4
    setup(member('u-me', 'Me', 'OWNER'), true)
    expect(screen.getByRole('button', { name: 'Invite' })).toBeDisabled()
    expect(
      screen.getByText('Member limit reached (4). An admin can raise it.'),
    ).toBeInTheDocument()
  })

  it('keeps Invite enabled with no cap', () => {
    setup(member('u-me', 'Me', 'OWNER'), true)
    expect(screen.getByRole('button', { name: 'Invite' })).toBeEnabled()
    expect(screen.getByText('4')).toBeInTheDocument()
  })
})
