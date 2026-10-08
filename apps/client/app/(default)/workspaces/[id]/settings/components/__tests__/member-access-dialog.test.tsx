import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

function renderDialog(m: WorkspaceMember) {
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
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(2)
    for (const box of boxes) expect(box).toBeDisabled()
    expect(
      screen.getByText('Owners and staff already have this access.'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.updateMemberRole).toHaveBeenCalledWith('ws-1', 'm-1', 'STAFF', [])
    expect(onSaved).toHaveBeenCalled()
  })

  it('sends the grants ticked for a VIEWER', async () => {
    renderDialog(member('VIEWER'))
    const monitoring = screen.getAllByRole('checkbox')[0]!
    expect(monitoring).toBeEnabled()

    await userEvent.click(monitoring)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.updateMemberRole).toHaveBeenCalledWith('ws-1', 'm-1', 'VIEWER', [
      'MONITORING_VIEW',
    ])
  })

  it('starts from the VIEWER current grants and can revoke one', async () => {
    renderDialog(member('VIEWER', ['MONITORING_VIEW', 'NOTIFICATIONS_VIEW']))
    const notifications = screen.getAllByRole('checkbox')[1]!

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
