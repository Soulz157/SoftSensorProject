import { describe, expect, it } from 'vitest'
import {
  notificationEventHref,
  notificationEventTab,
} from './notification-event-link'

describe('notificationEventTab (MODEL-SERVE-022-T08/V09)', () => {
  it('maps every monitoring-axis event kind to the Monitoring tab', () => {
    for (const kind of [
      'MONITORING_ALERT',
      'MONITORING_WARNING',
      'SENSOR_FROZEN',
      'MONITORING_RECOVERED',
      'PREFLIGHT_FAILED',
      'MODEL_STARTED',
      'MODEL_STOPPED',
    ]) {
      expect(notificationEventTab(kind)).toBe('monitoring')
    }
  })

  it('maps retrain events to the Retrain tab', () => {
    expect(notificationEventTab('RETRAIN_SUCCEEDED')).toBe('retrain')
    expect(notificationEventTab('RETRAIN_FAILED')).toBe('retrain')
  })

  it('maps promote/rollback events to the Versions tab', () => {
    expect(notificationEventTab('VERSION_PROMOTED')).toBe('versions')
    expect(notificationEventTab('ROLLED_BACK')).toBe('versions')
  })

  it('falls back to the page default (input) for an unrecognised kind', () => {
    expect(notificationEventTab('SOME_FUTURE_EVENT')).toBe('input')
  })
})

describe('notificationEventHref', () => {
  it('builds a working link with the right ?tab= query', () => {
    expect(notificationEventHref('model-1', 'MONITORING_ALERT')).toBe(
      '/models/model-1?tab=monitoring',
    )
    expect(notificationEventHref('model-2', 'RETRAIN_FAILED')).toBe(
      '/models/model-2?tab=retrain',
    )
  })
})
