import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ON_EVENTS,
  NOTIFICATION_EVENT_LABEL,
  notificationEventLabel,
} from './notification-event-labels'

describe('notificationEventLabel (MODEL-SERVE-022-T05)', () => {
  it('labels every known event kind', () => {
    expect(notificationEventLabel('MONITORING_ALERT')).toBe('Monitoring: Alert')
    expect(notificationEventLabel('RETRAIN_FAILED')).toBe('Retrain failed')
  })

  it('falls back to the raw key for an unrecognised event — a server that ships a new kind must not render blank', () => {
    expect(notificationEventLabel('SOME_FUTURE_EVENT')).toBe(
      'SOME_FUTURE_EVENT',
    )
  })

  it('every DEFAULT_ON_EVENTS entry has a real label (no typo drifted the two lists apart)', () => {
    for (const event of DEFAULT_ON_EVENTS) {
      expect(NOTIFICATION_EVENT_LABEL[event]).toBeDefined()
    }
  })
})
