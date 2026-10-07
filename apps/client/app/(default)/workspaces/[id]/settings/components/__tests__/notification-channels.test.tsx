import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiError } from '@/lib/fetcher'

/** A failed load must never read as "this workspace has no channels" —
 *  the STAFF report of 2026-10-06 was exactly that: a 403 from a backend
 *  that predated STAFF read access, shown as the empty state. */

const listChannels = vi.fn()

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'staff-1' } },
    status: 'authenticated',
  }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/services/notification', () => ({
  notificationService: {
    listChannels: (...args: unknown[]) => listChannels(...args),
  },
}))
vi.mock('@/hooks/workspace/use-workspace-members', () => ({
  useWorkspaceMembers: () => ({ members: [], isOwner: false }),
}))
vi.mock('@/hooks/workspace/use-workspace-models', () => ({
  useWorkspaceModels: () => ({ models: [] }),
}))

import { NotificationChannels } from '../notification-channels'

const CHANNEL = {
  id: 'c1',
  kind: 'TEAMS_WORKFLOW',
  name: 'ROC Teams',
  enabled: true,
  minSeverity: 'WARNING',
  events: ['MONITORING_ALERT'],
  cooldownMinutes: 30,
  focusModelIds: [],
  recipientUserIds: [],
  hasTarget: true,
}

describe('NotificationChannels load failures', () => {
  beforeEach(() => {
    listChannels.mockReset()
  })

  it('a 403 says so instead of "No notification channels yet."', async () => {
    const forbidden = new ApiError(
      'Only workspace owners can perform this action',
      403,
    )
    listChannels.mockImplementation(async () => {
      throw forbidden
    })
    render(<NotificationChannels workspaceId="roc" />)

    expect(
      await screen.findByText(
        "You don't have access to this workspace's notification channels.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('No notification channels yet.')).toBeNull()
  })

  it('any other failure shows the server message and a Retry that refetches', async () => {
    listChannels
      .mockRejectedValueOnce(new ApiError('Internal server error', 500))
      .mockResolvedValueOnce({
        data: { channels: [CHANNEL], knownEvents: ['MONITORING_ALERT'] },
      })
    render(<NotificationChannels workspaceId="roc" />)

    expect(
      await screen.findByText(
        "Couldn't load notification channels — Internal server error",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('No notification channels yet.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('ROC Teams')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.queryByText(/Couldn't load notification channels/),
      ).toBeNull(),
    )
    expect(listChannels).toHaveBeenCalledTimes(2)
  })

  it('a successful empty load still shows the empty state', async () => {
    listChannels.mockResolvedValue({ data: { channels: [], knownEvents: [] } })
    render(<NotificationChannels workspaceId="roc" />)

    expect(
      await screen.findByText('No notification channels yet.'),
    ).toBeInTheDocument()
  })
})
