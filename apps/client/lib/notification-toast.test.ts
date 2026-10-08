import { describe, it, expect } from 'vitest'
import {
  newToastEvents,
  notificationEventDetail,
  notificationToastTitle,
} from './notification-toast'
import type { NotificationEventItem } from '@/types'

const ev = (
  over: Partial<NotificationEventItem> = {},
): NotificationEventItem => ({
  id: 'e1',
  modelId: 'm1',
  modelName: 'Mock Model',
  axis: null,
  kind: 'MONITORING_ALERT',
  severity: 'CRITICAL',
  fromStatus: null,
  toStatus: null,
  reason: null,
  createdAt: '2026-10-08T01:00:00.000Z',
  unread: true,
  ...over,
})

describe('newToastEvents', () => {
  it('toasts WARNING and CRITICAL, never INFO', () => {
    const items = [
      ev({ id: 'c', severity: 'CRITICAL' }),
      ev({ id: 'w', severity: 'WARNING' }),
      ev({ id: 'i', severity: 'INFO', kind: 'MODEL_STARTED' }),
    ]
    expect(
      newToastEvents(items, new Set())
        .map(e => e.id)
        .sort(),
    ).toEqual(['c', 'w'])
  })

  it('skips events already seen and events already read', () => {
    const items = [
      ev({ id: 'seen' }),
      ev({ id: 'read', unread: false }),
      ev({ id: 'new' }),
    ]
    expect(newToastEvents(items, new Set(['seen'])).map(e => e.id)).toEqual([
      'new',
    ])
  })

  it('orders oldest first (the feed is newest first)', () => {
    const items = [
      ev({ id: 'late', createdAt: '2026-10-08T03:00:00.000Z' }),
      ev({ id: 'early', createdAt: '2026-10-08T01:00:00.000Z' }),
    ]
    expect(newToastEvents(items, new Set()).map(e => e.id)).toEqual([
      'early',
      'late',
    ])
  })
})

describe('toast text', () => {
  it('title names the model and the event', () => {
    expect(notificationToastTitle(ev())).toBe('Mock Model · Monitoring: Alert')
  })

  it('detail: transition with reason, bare level, or the event label', () => {
    expect(
      notificationEventDetail(
        ev({
          fromStatus: 'warning',
          toStatus: 'alert',
          reason: 'PSI_CRITICAL',
        }),
      ),
    ).toMatch(/^warning -> alert \(.+\)$/)
    expect(notificationEventDetail(ev({ toStatus: 'alert' }))).toBe('alert')
    expect(notificationEventDetail(ev({ kind: 'RETRAIN_FAILED' }))).toBe(
      'Retrain failed',
    )
  })
})
