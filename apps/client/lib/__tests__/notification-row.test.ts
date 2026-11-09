import { describe, it, expect } from 'vitest'
import {
  formatUtcTimestamp,
  rowFields,
  rowSummary,
  rowTimestamp,
  rowTitle,
} from '../notification-row'
import type { NotificationEventItem } from '@/types'

/** An event from an older server: none of the MODEL-SERVE-039 fields. */
const legacy: NotificationEventItem = {
  id: 'ev-1',
  modelId: 'm-1',
  modelName: 'Mock TM2',
  axis: 'MONITORING',
  kind: 'MONITORING_WARNING',
  severity: 'WARNING',
  fromStatus: 'normal',
  toStatus: 'warning',
  reason: null,
  createdAt: '2026-10-22T01:29:00.000Z',
  unread: true,
}

/** The deploy-failed event the alert mockup shows. */
const alert: NotificationEventItem = {
  ...legacy,
  axis: 'DEPLOY',
  kind: 'PREFLIGHT_FAILED',
  severity: 'CRITICAL',
  fromStatus: null,
  toStatus: null,
  title: 'Lab Quality-1 Soft Sensor: deploy failed',
  workspaceName: 'Plant A',
  detailText: 'running -> error (deploy failed)',
  reasonText: 'PI returned no current reading for these mapped tags.',
  frozenText: null,
  alertTimestamp: '22 Oct 2026 01:29 UTC',
}

describe('notification row — the alert, read for the bell (MODEL-SERVE-039)', () => {
  it('uses the alert’s own title, detail and time', () => {
    expect(rowTitle(alert)).toBe('Lab Quality-1 Soft Sensor: deploy failed')
    expect(rowSummary(alert)).toBe('running -> error (deploy failed)')
    expect(rowTimestamp(alert)).toBe('22 Oct 2026 01:29 UTC')
  })

  it('falls back to the toast wording for an event with no alert fields', () => {
    expect(rowTitle(legacy)).toBe('Mock TM2 · Monitoring: Warning')
    expect(rowSummary(legacy)).toBe('normal -> warning')
    expect(rowTimestamp(legacy)).toBe('22 Oct 2026 01:29 UTC')
  })

  it('an explicit null title or detail also falls back, never blank', () => {
    const nulls = { ...legacy, title: null, detailText: null }
    expect(rowTitle(nulls)).toBe('Mock TM2 · Monitoring: Warning')
    expect(rowSummary(nulls)).toBe('normal -> warning')
  })

  it('lists the expanded lines in the alert’s order and omits what is missing', () => {
    expect(rowFields(alert)).toEqual([
      { label: 'Workspace', value: 'Plant A' },
      { label: 'Detail', value: 'running -> error (deploy failed)' },
      {
        label: 'Reason',
        value: 'PI returned no current reading for these mapped tags.',
      },
    ])
    expect(rowFields(legacy)).toEqual([
      { label: 'Detail', value: 'normal -> warning' },
    ])
    expect(
      rowFields({
        ...alert,
        reasonText: null,
        frozenText: 'TI-101 (flat 90min)',
      }).map(f => f.label),
    ).toEqual(['Workspace', 'Detail', 'Frozen'])
  })

  it.each([
    ['2026-10-22T01:29:00.000Z', '22 Oct 2026 01:29 UTC'],
    ['2026-09-29T06:05:21.724Z', '29 Sep 2026 06:05 UTC'],
    ['2026-01-02T23:59:59.000Z', '2 Jan 2026 23:59 UTC'],
  ])('formats %s as the alert does', (iso, expected) => {
    expect(formatUtcTimestamp(iso)).toBe(expected)
  })

  it('returns an unparseable time unchanged instead of "NaN"', () => {
    expect(formatUtcTimestamp('not a date')).toBe('not a date')
  })
})
