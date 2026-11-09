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

/** The deploy-failed event, with the alert's own fields (MODEL-SERVE-039). */
const deployFailed: NotificationEventItem = {
  ...item,
  id: 'ev-2',
  modelName: 'Lab Quality-1 Soft Sensor',
  axis: 'DEPLOY',
  kind: 'PREFLIGHT_FAILED',
  severity: 'CRITICAL',
  fromStatus: null,
  toStatus: null,
  createdAt: '2026-10-22T01:29:00.000Z',
  title: 'Lab Quality-1 Soft Sensor: deploy failed',
  workspaceName: 'Plant A',
  detailText: 'running -> error (deploy failed)',
  reasonText: 'PI returned no current reading for these mapped tags.',
  alertTimestamp: '22 Oct 2026 01:29 UTC',
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

  it('no button is nested inside any menu item or the Open model link', async () => {
    const user = await open()
    await user.click(
      screen.getByRole('menuitem', { name: /Mock TM2 · Monitoring: Warning/ }),
    )
    const link = screen.getByRole('menuitem', { name: /Open model/ })
    expect(link.tagName).toBe('A')
    expect(link.querySelector('button')).toBeNull()
    for (const row of screen.getAllByRole('menuitem'))
      expect(row.querySelector('button')).toBeNull()
  })

  it('Clear all is hidden when the bell is empty', async () => {
    hook.items = []
    hook.loadItems = vi.fn().mockResolvedValue([])
    await open()
    expect(screen.queryByRole('menuitem', { name: 'Clear all' })).toBeNull()
    expect(hook.markAllRead).not.toHaveBeenCalled()
  })
})

describe("NavbarNotifications — the alert's format (MODEL-SERVE-039)", () => {
  beforeEach(() => {
    hook.items = [deployFailed, item]
    hook.loadItems = vi.fn().mockResolvedValue([deployFailed, item])
    for (const k of [
      'markAllRead',
      'dismiss',
      'clearAll',
      'muteModel',
    ] as const)
      hook[k] = vi.fn()
  })

  it('collapsed: the alert title, a severity chip and the one-line detail — no extra fields', async () => {
    await open()
    const toggle = screen.getByRole('menuitem', {
      name: /Lab Quality-1 Soft Sensor: deploy failed/,
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(toggle).getByText('Critical')).toBeInTheDocument()
    expect(
      within(toggle).getByText('running -> error (deploy failed)'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Workspace')).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Open model/ })).toBeNull()
  })

  it('a row without alert fields still reads: model · event, chip, transition', async () => {
    await open()
    const toggle = screen.getByRole('menuitem', {
      name: /Mock TM2 · Monitoring: Warning/,
    })
    expect(within(toggle).getByText('Warning')).toBeInTheDocument()
    expect(within(toggle).getByText('normal -> warning')).toBeInTheDocument()
  })

  it('clicking a row opens it in place: Workspace, Detail, Reason, UTC time, Open model', async () => {
    const user = await open()
    await user.click(
      screen.getByRole('menuitem', {
        name: /Lab Quality-1 Soft Sensor: deploy failed/,
      }),
    )
    // The bell stays open, and the row now reports expanded.
    const toggle = screen.getByRole('menuitem', {
      name: /Lab Quality-1 Soft Sensor: deploy failed/,
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(screen.getByText('Plant A')).toBeInTheDocument()
    expect(screen.getByText('Detail')).toBeInTheDocument()
    expect(screen.getByText('Reason')).toBeInTheDocument()
    expect(
      screen.getByText(/PI returned no current reading/),
    ).toBeInTheDocument()
    expect(screen.getByText(/22 Oct 2026 01:29 UTC/)).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: /Open model/ }),
    ).toHaveAttribute('href', '/models/m-1?tab=monitoring')
  })

  it('clicking again folds it back, and other rows stay folded', async () => {
    const user = await open()
    const name = /Lab Quality-1 Soft Sensor: deploy failed/
    await user.click(screen.getByRole('menuitem', { name }))
    expect(screen.getAllByText('Workspace')).toHaveLength(1)
    await user.click(screen.getByRole('menuitem', { name }))
    expect(screen.queryByText('Workspace')).toBeNull()
    expect(screen.getByRole('menuitem', { name })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('Remove and Mute on the new row act on that event', async () => {
    const user = await open()
    await user.click(
      screen.getByRole('menuitem', {
        name: 'Remove Lab Quality-1 Soft Sensor notification',
      }),
    )
    expect(hook.dismiss).toHaveBeenCalledWith(deployFailed)
    expect(hook.muteModel).not.toHaveBeenCalled()
  })
})
