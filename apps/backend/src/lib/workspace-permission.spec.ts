import {
  canReadWithGrant,
  normalizePermissions,
  type MemberAccess,
} from './workspace-permission';

const member = (
  role: MemberAccess['role'],
  permissions: MemberAccess['permissions'] = [],
): MemberAccess => ({ role, permissions });

describe('canReadWithGrant', () => {
  it('denies a non-member', () => {
    expect(canReadWithGrant(null, 'MONITORING_VIEW')).toBe(false);
  });

  it.each(['OWNER', 'STAFF'] as const)('admits %s without a grant', (role) => {
    expect(canReadWithGrant(member(role), 'MONITORING_VIEW')).toBe(true);
    expect(canReadWithGrant(member(role), 'NOTIFICATIONS_VIEW')).toBe(true);
  });

  it('denies a VIEWER without the grant', () => {
    expect(canReadWithGrant(member('VIEWER'), 'MONITORING_VIEW')).toBe(false);
  });

  it('admits a VIEWER for the granted feature only', () => {
    const viewer = member('VIEWER', ['MONITORING_VIEW']);
    expect(canReadWithGrant(viewer, 'MONITORING_VIEW')).toBe(true);
    expect(canReadWithGrant(viewer, 'NOTIFICATIONS_VIEW')).toBe(false);
  });
});

describe('normalizePermissions', () => {
  it.each(['OWNER', 'STAFF'] as const)('stores nothing for %s', (role) => {
    expect(
      normalizePermissions(role, ['MONITORING_VIEW', 'NOTIFICATIONS_VIEW']),
    ).toEqual([]);
  });

  it('keeps and de-dupes a VIEWER grant list', () => {
    expect(
      normalizePermissions('VIEWER', ['MONITORING_VIEW', 'MONITORING_VIEW']),
    ).toEqual(['MONITORING_VIEW']);
  });
});
