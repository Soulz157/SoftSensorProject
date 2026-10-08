import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NotificationEventItem } from '@/types'
import { TooltipProvider } from '@/components/ui/tooltip'

const hook = {
  unreadCount: 1,
  items: [] as NotificationEventItem[],
  loading: false,
  loadItems: vi.fn(),
  markAllRead: vi.fn(),
  dismiss: vi.fn(),
  clearAll: vi.fn(),
  muteModel: vi.fn(),
}
vi.mock('@/hooks/notifications/use-notifications', () => ({
  useNotifications: () => hook,
}))
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode
    href: string
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { NavbarNotifications } from '../navbar-notification'

const item: NotificationEventItem = {
  id: 'ev-1',
  modelId: 'm-1',
  modelName: 'Mock TM2',
  axis: 'MONITORING',
  kind: 'MONITORING_WARNING',
  severity: 'WARNING',
  fromStatus: 'normal',
  toStatus: 'warning',
  reason: null,
  createdAt: '2026-10-08T02:00:00.000Z',
  unread: true,
}

async function open() {
  const user = userEvent.setup()
  render(
    <TooltipProvider>
      <NavbarNotifications />
    </TooltipProvider>,
  )
  await user.click(screen.getByRole('button'))
  return user
}

describe('NavbarNotifications', () => {
  beforeEach(() => {
    hook.items = [item]
    hook.loadItems = vi.fn().mockResolvedValue([item])
    for (const k of [
      'markAllRead',
      'dismiss',
      'clearAll',
      'muteModel',
    ] as const)
      hook[k] = vi.fn()
  })

  it('opening loads, then marks read only up to the newest event shown', async () => {
    await open()
    expect(hook.loadItems).toHaveBeenCalled()
    await vi.waitFor(() =>
      expect(hook.markAllRead).toHaveBeenCalledWith('2026-10-08T02:00:00.000Z'),
    )
  })

  it('X removes the row without muting the model', async () => {
    const user = await open()
    await user.click(
      screen.getByRole('menuitem', { name: 'Remove Mock TM2 notification' }),
    )
    expect(hook.dismiss).toHaveBeenCalledWith(item)
    expect(hook.muteModel).not.toHaveBeenCalled()
  })

  it('Clear all clears without muting', async () => {
    const user = await open()
    await user.click(screen.getByRole('menuitem', { name: 'Clear all' }))
    expect(hook.clearAll).toHaveBeenCalled()
    expect(hook.muteModel).not.toHaveBeenCalled()
  })

  it('Mute is only behind the ⋯ menu', async () => {
    const user = await open()
    expect(
      screen.queryByRole('menuitem', { name: /Mute this model/ }),
    ).toBeNull()
    // Keyboard path: focus ⋯, ArrowRight opens the sub-menu (focus moves
    // into it), Enter picks Mute.
    screen.getByRole('menuitem', { name: 'More actions for Mock TM2' }).focus()
    await user.keyboard('{ArrowRight}')
    const mute = await screen.findByRole('menuitem', {
      name: /Mute this model/,
    })
    await vi.waitFor(() => expect(mute).toHaveFocus())
    await user.keyboard('{Enter}')
    expect(hook.muteModel).toHaveBeenCalledWith('m-1')
  })

  it('no button is nested inside the row link', async () => {
    await open()
    const link = screen.getByRole('menuitem', { name: /Mock TM2.*warning/ })
    expect(link.tagName).toBe('A')
    expect(within(link).queryByRole('button')).toBeNull()
    expect(link.querySelector('button')).toBeNull()
  })

  it('Clear all is hidden when the bell is empty', async () => {
    hook.items = []
    hook.loadItems = vi.fn().mockResolvedValue([])
    await open()
    expect(screen.queryByRole('menuitem', { name: 'Clear all' })).toBeNull()
    expect(hook.markAllRead).not.toHaveBeenCalled()
  })
})
