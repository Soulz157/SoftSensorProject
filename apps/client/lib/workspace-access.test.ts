import { describe, it, expect } from 'vitest'
import type { WorkspacePermission } from '@/types'
import {
  assignableRoleOptions,
  canManageMemberRow,
  FULL_MEMBER_ACCESS,
  grantedPermissionLabels,
  invitableRoleOptions,
  isMonitoringDenied,
  memberCan,
  memberManagementAccess,
  roleCanManageDatasets,
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

describe('roleCanManageDatasets', () => {
  it.each(['OWNER', 'STAFF'] as const)('is true for %s', role => {
    expect(roleCanManageDatasets(role)).toBe(true)
  })

  it('is false for VIEWER', () => {
    expect(roleCanManageDatasets('VIEWER')).toBe(false)
  })
})

describe('staff grants (MODEL-SERVE-034)', () => {
  const owner = { role: 'OWNER' as const, permissions: [] }
  const staff = (permissions: WorkspacePermission[] = []) => ({
    role: 'STAFF' as const,
    permissions,
  })

  it('keeps only staff grants for STAFF and only read grants for VIEWER', () => {
    const all: WorkspacePermission[] = [
      'MONITORING_VIEW',
      'MEMBER_ROLE_ASSIGN',
      'MEMBER_INVITE',
    ]
    expect(toPermissionPayload('STAFF', all)).toEqual([
      'MEMBER_ROLE_ASSIGN',
      'MEMBER_INVITE',
    ])
    expect(toPermissionPayload('VIEWER', all)).toEqual(['MONITORING_VIEW'])
    expect(toPermissionPayload('OWNER', all)).toEqual([])
  })

  it('labels a STAFF member staff grants as row chips', () => {
    expect(grantedPermissionLabels(staff(['MEMBER_INVITE']))).toEqual([
      'Invite members',
    ])
  })

  it('gives an owner full access, even with no member row', () => {
    expect(memberManagementAccess(null, true)).toEqual(FULL_MEMBER_ACCESS)
    expect(memberManagementAccess(owner, false)).toEqual(FULL_MEMBER_ACCESS)
  })

  it('gives a STAFF only the ticked grants, and a VIEWER nothing', () => {
    expect(
      memberManagementAccess(staff(['MEMBER_ROLE_ASSIGN']), false),
    ).toEqual({ full: false, assignRoles: true, invite: false })
    expect(
      memberManagementAccess(
        { role: 'VIEWER', permissions: ['MEMBER_ROLE_ASSIGN'] },
        false,
      ),
    ).toEqual({ full: false, assignRoles: false, invite: false })
  })

  it('shows a delegate the menu only on other, non-owner rows', () => {
    const delegate = { full: false, assignRoles: true, invite: false }
    const row = (role: 'OWNER' | 'STAFF' | 'VIEWER', userId = 'other') => ({
      role,
      userId,
    })
    expect(canManageMemberRow(delegate, row('VIEWER'), 'me')).toBe(true)
    expect(canManageMemberRow(delegate, row('STAFF'), 'me')).toBe(true)
    expect(canManageMemberRow(delegate, row('OWNER'), 'me')).toBe(false)
    expect(canManageMemberRow(delegate, row('STAFF', 'me'), 'me')).toBe(false)
    expect(
      canManageMemberRow(
        { ...delegate, assignRoles: false },
        row('VIEWER'),
        'me',
      ),
    ).toBe(false)
    expect(
      canManageMemberRow(FULL_MEMBER_ACCESS, row('OWNER', 'me'), 'me'),
    ).toBe(true)
  })

  it('never offers OWNER to a delegate', () => {
    const delegate = { full: false, assignRoles: true, invite: true }
    expect(assignableRoleOptions(delegate).map(o => o.value)).toEqual([
      'STAFF',
      'VIEWER',
    ])
    expect(invitableRoleOptions(delegate).map(o => o.value)).not.toContain(
      'OWNER',
    )
    expect(
      assignableRoleOptions(FULL_MEMBER_ACCESS).map(o => o.value),
    ).toContain('OWNER')
  })
})
