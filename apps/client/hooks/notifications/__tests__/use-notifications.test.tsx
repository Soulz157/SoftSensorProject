import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, renderHook } from '@testing-library/react'
import type { NotificationEventItem } from '@/types'

const unreadCount = vi.fn()
const listEvents = vi.fn()
const push = vi.fn()
const toastFn = vi.fn()
const toastError = vi.fn()
const toastWarning = vi.fn()
const markRead = vi.fn()
const dismissApi = vi.fn()
const clearApi = vi.fn()

vi.mock('@/services/notification', () => ({
  notificationFeedService: {
    unreadCount: () => unreadCount(),
    listEvents: (p: unknown) => listEvents(p),
    markRead: (upTo?: string) => markRead(upTo),
    dismiss: (id: string) => dismissApi(id),
    clear: (upTo?: string) => clearApi(upTo),
    muteModel: vi.fn(),
  },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({
  toast: Object.assign((...a: unknown[]) => toastFn(...a), {
    error: (...a: unknown[]) => toastError(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
    success: vi.fn(),
  }),
}))

import { useNotifications } from '../use-notifications'

const ev = (
  id: string,
  over: Partial<NotificationEventItem> = {},
): NotificationEventItem => ({
  id,
  modelId: `m-${id}`,
  modelName: `Mock ${id}`,
  axis: null,
  kind: 'MONITORING_ALERT',
  severity: 'CRITICAL',
  fromStatus: null,
  toStatus: 'alert',
  reason: null,
  createdAt: `2026-10-08T01:00:0${id.length % 10}.000Z`,
  unread: true,
  ...over,
})

const count = (n: number, pollIntervalMs = 300_000) =>
  unreadCount.mockResolvedValue({ data: { count: n, pollIntervalMs } })
const feed = (items: NotificationEventItem[]) =>
  listEvents.mockResolvedValue({ data: { items, nextCursor: null } })

/** Mount, then let the first poll + baseline settle. */
async function mount() {
  const hook = renderHook(() => useNotifications())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  return hook
}
const focus = () =>
  act(async () => {
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
  })

describe('useNotifications — new-event toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    for (const m of [markRead, dismissApi, clearApi]) {
      m.mockReset()
      m.mockResolvedValue({})
    }
    for (const m of [
      unreadCount,
      listEvents,
      push,
      toastFn,
      toastError,
      toastWarning,
    ])
      m.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('events that existed at page load never toast', async () => {
    count(2)
    feed([ev('old1'), ev('old2', { severity: 'WARNING' })])
    const { result } = await mount()
    expect(result.current.unreadCount).toBe(2)
    expect(listEvents).toHaveBeenCalledTimes(1) // the baseline
    expect(toastError).not.toHaveBeenCalled()
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('a new CRITICAL event toasts once, with Open to the right tab', async () => {
    count(0)
    feed([])
    await mount()

    count(1)
    feed([ev('new')])
    await focus()
    expect(toastError).toHaveBeenCalledTimes(1)
    const [title, opts] = toastError.mock.calls[0] as [
      string,
      {
        description: string
        toasterId: string
        action: { label: React.ReactNode; onClick: () => void }
      },
    ]
    expect(title).toBe('Mock new · Monitoring: Alert')
    expect(opts.description).toBe('alert')
    // Goes to the top-right notifications Toaster, not the default one.
    expect(opts.toasterId).toBe('notifications')
    // Icon-only action: no visible "Open" text, but a screen-reader name.
    const { container } = render(<>{opts.action.label}</>)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toBe('Open Mock new')
    opts.action.onClick()
    expect(push).toHaveBeenCalledWith('/models/m-new?tab=monitoring')

    // Same event on the next poll (count unchanged): no second toast.
    await focus()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('WARNING uses toast.warning; INFO never toasts', async () => {
    count(0)
    feed([])
    await mount()

    count(2)
    feed([
      ev('w', { severity: 'WARNING', kind: 'MONITORING_WARNING' }),
      ev('i', { severity: 'INFO', kind: 'MODEL_STARTED' }),
    ])
    await focus()
    expect(toastWarning).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
    expect(toastFn).not.toHaveBeenCalled()
  })

  it('more than 3 new events: 3 toasts plus one summary', async () => {
    count(0)
    feed([])
    await mount()

    count(5)
    feed(['a', 'bb', 'ccc', 'dddd', 'eeeee'].map(id => ev(id)))
    await focus()
    expect(toastError).toHaveBeenCalledTimes(3)
    expect(toastFn).toHaveBeenCalledWith(
      '2 more new notifications',
      expect.objectContaining({ toasterId: 'notifications' }),
    )
  })

  it('after mark-all-read, the next new event still toasts', async () => {
    count(3)
    feed([ev('x'), ev('y'), ev('z')])
    const { result } = await mount()
    await act(async () => {
      await result.current.markAllRead()
    })

    count(1)
    feed([ev('fresh'), ev('x', { unread: false })])
    await focus()
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError.mock.calls[0]?.[0]).toBe('Mock fresh · Monitoring: Alert')
  })

  it("polls on the server's interval, not the 5-minute fallback", async () => {
    count(0, 60_000)
    feed([])
    await mount()
    expect(unreadCount).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(unreadCount).toHaveBeenCalledTimes(2)
  })
})

describe('useNotifications — removing history (silent, per user)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    for (const m of [
      unreadCount,
      listEvents,
      toastFn,
      toastError,
      toastWarning,
    ])
      m.mockReset()
    for (const m of [markRead, dismissApi, clearApi]) {
      m.mockReset()
      m.mockResolvedValue({})
    }
  })
  afterEach(() => vi.useRealTimers())

  async function loaded(items: NotificationEventItem[], unread: number) {
    count(unread)
    feed(items)
    const hook = await mount()
    await act(async () => {
      await hook.result.current.loadItems()
    })
    return hook
  }

  it('X removes one row, drops the badge if it was unread, and toasts nothing', async () => {
    const a = ev('a', { createdAt: '2026-10-08T02:00:00.000Z' })
    const b = ev('b', { createdAt: '2026-10-08T01:00:00.000Z', unread: false })
    const { result } = await loaded([a, b], 1)
    await act(async () => {
      await result.current.dismiss(a)
    })
    expect(dismissApi).toHaveBeenCalledWith('a')
    expect(result.current.items.map(i => i.id)).toEqual(['b'])
    expect(result.current.unreadCount).toBe(0)
    expect(toastFn).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('a failed X puts the row back, in order, and says so', async () => {
    const a = ev('a', { createdAt: '2026-10-08T02:00:00.000Z' })
    const b = ev('b', { createdAt: '2026-10-08T01:00:00.000Z' })
    const { result } = await loaded([a, b], 2)
    dismissApi.mockRejectedValue(new Error('down'))
    await act(async () => {
      await result.current.dismiss(a)
    })
    expect(result.current.items.map(i => i.id)).toEqual(['a', 'b'])
    expect(result.current.unreadCount).toBe(2)
    expect(toastError).toHaveBeenCalledWith("Couldn't remove the notification")
  })

  it('Clear all empties the bell up to the newest event shown, silently', async () => {
    const a = ev('a', { createdAt: '2026-10-08T02:00:00.000Z' })
    const b = ev('b', { createdAt: '2026-10-08T01:00:00.000Z' })
    const { result } = await loaded([a, b], 2)
    await act(async () => {
      await result.current.clearAll()
    })
    expect(clearApi).toHaveBeenCalledWith('2026-10-08T02:00:00.000Z')
    expect(result.current.items).toEqual([])
    expect(result.current.unreadCount).toBe(0)
    expect(toastFn).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('after Clear all, the next new event still toasts', async () => {
    const { result } = await loaded([ev('old')], 1)
    await act(async () => {
      await result.current.clearAll()
    })
    count(1)
    feed([ev('fresh')])
    await focus()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('mark read is sent up to the given event, not "now"', async () => {
    const { result } = await loaded([ev('a')], 1)
    await act(async () => {
      await result.current.markAllRead('2026-10-08T02:00:00.000Z')
    })
    expect(markRead).toHaveBeenCalledWith('2026-10-08T02:00:00.000Z')
  })
})
