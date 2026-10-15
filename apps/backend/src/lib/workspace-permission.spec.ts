import {
  canReadWithGrant,
  canWriteBack,
  inviteBlocker,
  memberManagement,
  normalizePermissions,
  roleChangeBlocker,
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

describe('normalizePermissions per role (MODEL-SERVE-034)', () => {
  const all = [
    'MONITORING_VIEW',
    'NOTIFICATIONS_VIEW',
    'MEMBER_ROLE_ASSIGN',
    'MEMBER_INVITE',
  ] as const;

  it('keeps only member-management grants for STAFF', () => {
    expect(normalizePermissions('STAFF', [...all])).toEqual([
      'MEMBER_ROLE_ASSIGN',
      'MEMBER_INVITE',
    ]);
  });

  it('keeps only read grants for VIEWER', () => {
    expect(normalizePermissions('VIEWER', [...all])).toEqual([
      'MONITORING_VIEW',
      'NOTIFICATIONS_VIEW',
    ]);
  });

  it('keeps nothing for OWNER', () => {
    expect(normalizePermissions('OWNER', [...all])).toEqual([]);
  });
});

describe('memberManagement', () => {
  it('gives the creator and an OWNER row everything', () => {
    const everything = { full: true, assignRoles: true, invite: true };
    expect(memberManagement({ isWorkspaceOwner: true, member: null })).toEqual(
      everything,
    );
    expect(
      memberManagement({ isWorkspaceOwner: false, member: member('OWNER') }),
    ).toEqual(everything);
  });

  it('gives a STAFF only the grants an owner ticked', () => {
    expect(
      memberManagement({
        isWorkspaceOwner: false,
        member: member('STAFF', ['MEMBER_INVITE']),
      }),
    ).toEqual({ full: false, assignRoles: false, invite: true });
  });

  it('ignores member-management grants on a VIEWER row', () => {
    expect(
      memberManagement({
        isWorkspaceOwner: false,
        member: member('VIEWER', ['MEMBER_ROLE_ASSIGN', 'MEMBER_INVITE']),
      }),
    ).toEqual({ full: false, assignRoles: false, invite: false });
  });
});

describe('roleChangeBlocker / inviteBlocker', () => {
  const delegate = { full: false, assignRoles: true, invite: true };
  const target = { userId: 'other', role: 'VIEWER' as const };

  it('lets a delegate switch someone else between STAFF and VIEWER', () => {
    expect(
      roleChangeBlocker({
        access: delegate,
        actorUserId: 'me',
        target,
        nextRole: 'STAFF',
      }),
    ).toBeNull();
  });

  it.each([
    ['no grant', { ...delegate, assignRoles: false }, target, 'STAFF'],
    ['own row', delegate, { ...target, userId: 'me' }, 'STAFF'],
    ['owner target', delegate, { ...target, role: 'OWNER' as const }, 'VIEWER'],
    ['promotion to OWNER', delegate, target, 'OWNER'],
  ] as const)('blocks a delegate: %s', (_, access, t, nextRole) => {
    expect(
      roleChangeBlocker({ access, actorUserId: 'me', target: t, nextRole }),
    ).toEqual(expect.any(String));
  });

  it('never blocks an owner', () => {
    expect(
      roleChangeBlocker({
        access: { full: true, assignRoles: true, invite: true },
        actorUserId: 'me',
        target: { userId: 'me', role: 'OWNER' },
        nextRole: 'VIEWER',
      }),
    ).toBeNull();
  });

  it('lets a delegate invite as STAFF/VIEWER but not OWNER', () => {
    expect(inviteBlocker(delegate, 'VIEWER')).toBeNull();
    expect(inviteBlocker(delegate, 'STAFF')).toBeNull();
    expect(inviteBlocker(delegate, 'OWNER')).toEqual(expect.any(String));
    expect(inviteBlocker({ ...delegate, invite: false }, 'VIEWER')).toEqual(
      expect.any(String),
    );
  });
});
