import { describe, it, expect } from 'vitest'
import {
  grantedPermissionLabels,
  isMonitoringDenied,
  memberCan,
  toPermissionPayload,
} from './workspace-access'

describe('memberCan', () => {
  it('denies when there is no member row', () => {
    expect(memberCan(null, 'MONITORING_VIEW')).toBe(false)
  })

  it.each(['OWNER', 'STAFF'] as const)('admits %s without a grant', role => {
    expect(memberCan({ role, permissions: [] }, 'MONITORING_VIEW')).toBe(true)
  })

  it('admits a VIEWER only for the granted feature', () => {
    const viewer = {
      role: 'VIEWER' as const,
      permissions: ['MONITORING_VIEW' as const],
    }
    expect(memberCan(viewer, 'MONITORING_VIEW')).toBe(true)
    expect(memberCan(viewer, 'NOTIFICATIONS_VIEW')).toBe(false)
  })
})

describe('toPermissionPayload', () => {
  it.each(['OWNER', 'STAFF'] as const)('sends no grants for %s', role => {
    expect(toPermissionPayload(role, ['MONITORING_VIEW'])).toEqual([])
  })

  it('de-dupes a VIEWER grant list', () => {
    expect(
      toPermissionPayload('VIEWER', [
        'NOTIFICATIONS_VIEW',
        'NOTIFICATIONS_VIEW',
      ]),
    ).toEqual(['NOTIFICATIONS_VIEW'])
  })
})

describe('grantedPermissionLabels', () => {
  it('lists a VIEWER grant labels in option order', () => {
    expect(
      grantedPermissionLabels({
        role: 'VIEWER',
        permissions: ['NOTIFICATIONS_VIEW', 'MONITORING_VIEW'],
      }),
    ).toEqual(['Model monitoring', 'Notifications'])
  })

  it('shows nothing for STAFF even if stale grants were returned', () => {
    expect(
      grantedPermissionLabels({
        role: 'STAFF',
        permissions: ['MONITORING_VIEW'],
      }),
    ).toEqual([])
  })
})

describe('isMonitoringDenied', () => {
  const base = {
    membersLoading: false,
    isWorkspaceCreator: false,
    isAdmin: false,
  }
  const viewer = { role: 'VIEWER' as const, permissions: [] }

  it('denies a VIEWER without the grant', () => {
    expect(isMonitoringDenied({ ...base, member: viewer })).toBe(true)
  })

  it('admits a VIEWER with MONITORING_VIEW', () => {
    expect(
      isMonitoringDenied({
        ...base,
        member: { role: 'VIEWER', permissions: ['MONITORING_VIEW'] },
      }),
    ).toBe(false)
  })

  it.each([
    ['members still loading', { membersLoading: true }],
    ['workspace creator', { isWorkspaceCreator: true }],
    ['global ADMIN', { isAdmin: true }],
  ])('never locks while uncertain or privileged: %s', (_l, extra) => {
    expect(isMonitoringDenied({ ...base, ...extra, member: viewer })).toBe(
      false,
    )
  })

  it('does not lock without a member row (backend decides)', () => {
    expect(isMonitoringDenied({ ...base, member: null })).toBe(false)
  })

  it('does not lock STAFF', () => {
    expect(
      isMonitoringDenied({
        ...base,
        member: { role: 'STAFF', permissions: [] },
      }),
    ).toBe(false)
  })
})
