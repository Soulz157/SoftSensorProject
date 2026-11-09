import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Manage access dialog (2026-10-07). Feature grants are a VIEWER-only
 * section: for OWNER/STAFF the checkboxes are locked (they already have the
 * access) and Save sends no grants; for a VIEWER the ticked grants are sent.
 */

const h = vi.hoisted(() => ({ updateMemberRole: vi.fn() }))

vi.mock('@/services/workspace', () => ({
  workspaceService: { updateMemberRole: h.updateMemberRole },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { MemberAccessDialog } from '../member-access-dialog'
import type { WorkspaceMember } from '@/types'
import type { MemberManagementAccess } from '@/lib/workspace-access'

function member(
  role: WorkspaceMember['role'],
  permissions: WorkspaceMember['permissions'] = [],
): WorkspaceMember {
  return {
    id: 'm-1',
    userId: 'u-1',
    role,
    permissions,
    createdAt: '2026-10-07T00:00:00.000Z',
    user: { id: 'u-1', firstName: 'Ada', lastName: null, email: 'a@x.test' },
  }
}

/** Feature grants only — the read-only Role access box is a separate group. */
function featureBoxes() {
  return within(
    screen.getByRole('group', { name: 'Feature access' }),
  ).getAllByRole('checkbox')
}

function renderDialog(m: WorkspaceMember, access?: MemberManagementAccess) {
  const onSaved = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <MemberAccessDialog
      workspaceId="ws-1"
      member={m}
      memberName="Ada"
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      access={access}
    />,
  )
  return { onSaved, onOpenChange }
}

describe('MemberAccessDialog', () => {
  beforeEach(() => {
    h.updateMemberRole.mockReset().mockResolvedValue({ data: {} })
  })

  it('locks the feature checkboxes for STAFF and sends no grants', async () => {
    const { onSaved } = renderDialog(member('STAFF'))
    const boxes = featureBoxes()
    expect(boxes).toHaveLength(2)
    for (const box of boxes) expect(box).toBeDisabled()
    expect(
      screen.getByText('Owners and staff already have this access.'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.updateMemberRole).toHaveBeenCalledWith('ws-1', 'm-1', 'STAFF', [])
    expect(onSaved).toHaveBeenCalled()
  })

  it.each([
    ['OWNER', true],
    ['STAFF', true],
    ['VIEWER', false],
  ] as const)(
    'shows Dataset management as included for %s: %s',
    (role, included) => {
      renderDialog(member(role))
      const box = within(
        screen.getByRole('group', { name: 'Role access' }),
      ).getByRole('checkbox', { name: /Dataset management/ })
      expect(box).toBeDisabled()
      if (included) expect(box).toBeChecked()
      else expect(box).not.toBeChecked()
    },
  )

  it('sends the grants ticked for a VIEWER', async () => {
    renderDialog(member('VIEWER'))
    const monitoring = featureBoxes()[0]!
    expect(monitoring).toBeEnabled()

    await userEvent.click(monitoring)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.updateMemberRole).toHaveBeenCalledWith('ws-1', 'm-1', 'VIEWER', [
      'MONITORING_VIEW',
    ])
  })

  it('starts from the VIEWER current grants and can revoke one', async () => {
    renderDialog(member('VIEWER', ['MONITORING_VIEW', 'NOTIFICATIONS_VIEW']))
    const notifications = featureBoxes()[1]!

    await userEvent.click(notifications)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.updateMemberRole).toHaveBeenCalledWith('ws-1', 'm-1', 'VIEWER', [
      'MONITORING_VIEW',
    ])
  })

  it('stays open and does not refetch when the save fails', async () => {
    h.updateMemberRole.mockRejectedValue(new Error('nope'))
    const { onSaved, onOpenChange } = renderDialog(member('VIEWER'))

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSaved).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

/** MODEL-SERVE-034. Staff member-management grants in the same dialog. */
describe('MemberAccessDialog — staff grants', () => {
  beforeEach(() => {
    h.updateMemberRole.mockReset().mockResolvedValue({ data: {} })
  })

  function staffBoxes() {
    return within(
      screen.getByRole('group', { name: 'Member management' }),
    ).getAllByRole('checkbox')
  }

  it('lets an owner grant a STAFF member "Assign roles"', async () => {
    renderDialog(member('STAFF'))
    const [assign] = staffBoxes()
    expect(assign).toBeEnabled()
    await userEvent.click(assign!)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.updateMemberRole).toHaveBeenCalledWith('ws-1', 'm-1', 'STAFF', [
      'MEMBER_ROLE_ASSIGN',
    ])
  })

  it('has no Member management section for a VIEWER', () => {
    renderDialog(member('VIEWER'))
    expect(
      screen.queryByRole('group', { name: 'Member management' }),
    ).not.toBeInTheDocument()
  })

  it('locks staff grants for a delegate and says why', () => {
    renderDialog(member('STAFF', ['MEMBER_INVITE']), {
      full: false,
      assignRoles: true,
      invite: false,
    })
    for (const box of staffBoxes()) expect(box).toBeDisabled()
    expect(staffBoxes()[1]).toBeChecked()
    expect(
      screen.getByText('Only an owner can change this.'),
    ).toBeInTheDocument()
  })

  it('never offers Owner to a delegate', async () => {
    renderDialog(member('VIEWER'), {
      full: false,
      assignRoles: true,
      invite: false,
    })
    await userEvent.click(screen.getByRole('combobox'))
    const names = screen.getAllByRole('option').map(o => o.textContent ?? '')
    expect(names.some(n => n.startsWith('Owner'))).toBe(false)
    expect(names.some(n => n.startsWith('Staff'))).toBe(true)
  })
})
