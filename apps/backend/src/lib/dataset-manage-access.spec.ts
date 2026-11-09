import { canManageDataset, canManageDatasetRow } from './dataset-manage-access';

const base = {
  userId: 'u1',
  createdById: 'other',
  workspaceOwnerId: 'ws-owner',
  memberRole: null,
} as const;

describe('canManageDataset', () => {
  it('creator manages whatever their role', () => {
    expect(
      canManageDataset({ ...base, createdById: 'u1', memberRole: 'VIEWER' }),
    ).toBe(true);
  });

  it('workspace creator manages any dataset', () => {
    expect(canManageDataset({ ...base, workspaceOwnerId: 'u1' })).toBe(true);
  });

  it.each(['OWNER', 'STAFF'] as const)(
    '%s member manages a teammate dataset',
    (memberRole) => {
      expect(canManageDataset({ ...base, memberRole })).toBe(true);
    },
  );

  it('VIEWER who did not create it cannot', () => {
    expect(canManageDataset({ ...base, memberRole: 'VIEWER' })).toBe(false);
  });

  it('non-member who did not create it cannot', () => {
    expect(canManageDataset(base)).toBe(false);
  });
});

describe('canManageDatasetRow', () => {
  it('reads role from the first member row', () => {
    expect(
      canManageDatasetRow(
        {
          createdById: 'other',
          workspace: { ownerId: 'ws-owner', members: [{ role: 'STAFF' }] },
        },
        'u1',
      ),
    ).toBe(true);
  });

  it('no member row → false for a non-creator', () => {
    expect(
      canManageDatasetRow(
        {
          createdById: 'other',
          workspace: { ownerId: 'ws-owner', members: [] },
        },
        'u1',
      ),
    ).toBe(false);
  });
});
