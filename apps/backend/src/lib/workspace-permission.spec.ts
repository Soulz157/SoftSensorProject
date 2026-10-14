import {
  canReadWithGrant,
  canWriteBack,
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

describe('canWriteBack', () => {
  const base = { globalRole: 'USER' as const, isWorkspaceOwner: false };

  it('admits a global ADMIN with no workspace tie', () => {
    expect(canWriteBack({ ...base, globalRole: 'ADMIN', member: null })).toBe(
      true,
    );
  });

  it('admits the workspace owner even without a member row', () => {
    expect(
      canWriteBack({ ...base, isWorkspaceOwner: true, member: null }),
    ).toBe(true);
  });

  it('admits a member with the OWNER role', () => {
    expect(canWriteBack({ ...base, member: { role: 'OWNER' } })).toBe(true);
  });

  it('refuses STAFF: they may edit the model but not write the plant historian', () => {
    expect(canWriteBack({ ...base, member: { role: 'STAFF' } })).toBe(false);
  });

  it('refuses a VIEWER, even one holding a monitoring grant', () => {
    expect(canWriteBack({ ...base, member: { role: 'VIEWER' } })).toBe(false);
  });

  it('refuses a non-member', () => {
    expect(canWriteBack({ ...base, member: null })).toBe(false);
  });
});
