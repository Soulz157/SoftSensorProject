/* eslint-disable @typescript-eslint/no-unsafe-member-access -- jest mocks are `any` by design */
import { dataSourceAccessWhere } from '@/lib/data-source-access';
import { DataSourceAuthorizedService } from './data-source.authorized.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'src-1',
  name: 'ROC',
  type: 'aveva',
  host: 'pi.local',
  username: 'svc_pi',
  secretCiphertext: 'cipher',
  dbName: '',
  config: null,
  status: 'connected',
  createdById: 'owner-1',
  workspaceId: 'ws-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  createdBy: { firstName: 'A', lastName: 'B' },
  ...over,
});

describe('dataSourceAccessWhere — workspace sharing', () => {
  it('matches the creator OR a member/owner of a non-deleted shared workspace', () => {
    expect(dataSourceAccessWhere('u-1')).toEqual({
      OR: [
        { createdById: 'u-1' },
        {
          workspace: {
            deletedAt: null,
            OR: [{ ownerId: 'u-1' }, { members: { some: { userId: 'u-1' } } }],
          },
        },
      ],
    });
  });
});

describe('DataSourceAuthorizedService — workspace sharing', () => {
  it('lists shared sources, filtered by workspace when asked', async () => {
    const findMany = jest.fn().mockResolvedValue([row()]);
    const service = new DataSourceAuthorizedService({
      dataSource: { findMany },
    } as never);

    await service.listDataSourceService('member-1', 'ws-1');

    expect(findMany.mock.calls[0][0].where).toEqual({
      ...dataSourceAccessWhere('member-1'),
      workspaceId: 'ws-1',
    });
  });

  it('a teammate gets canManage=false and no username; the creator gets both', async () => {
    const findMany = jest.fn().mockResolvedValue([row()]);
    const service = new DataSourceAuthorizedService({
      dataSource: { findMany },
    } as never);

    const asMember = await service.listDataSourceService('member-1');
    const asOwner = await service.listDataSourceService('owner-1');

    expect(asMember.data[0]).toMatchObject({ canManage: false, username: '' });
    expect(asOwner.data[0]).toMatchObject({
      canManage: true,
      username: 'svc_pi',
    });
    // The ciphertext never leaves the service, for anyone.
    expect(asMember.data[0]).not.toHaveProperty('secretCiphertext');
  });

  it('refuses to share into a workspace the creator is not in', async () => {
    const create = jest.fn();
    const service = new DataSourceAuthorizedService({
      workspace: { findFirst: jest.fn().mockResolvedValue(null) },
      dataSource: { create },
    } as never);

    await expect(
      service.createDataSourceService('owner-1', {
        name: 'x',
        type: 'aveva',
        host: '',
        username: '',
        password: '',
        dbName: '',
        workspaceId: '11111111-1111-1111-1111-111111111111',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(create).not.toHaveBeenCalled();
  });

  it('a teammate still cannot edit or delete a shared source', async () => {
    const update = jest.fn();
    const del = jest.fn();
    const service = new DataSourceAuthorizedService({
      dataSource: {
        findUnique: jest.fn().mockResolvedValue(row()),
        update,
        delete: del,
      },
    } as never);

    await expect(
      service.updateDataSourceService('member-1', 'src-1', { name: 'y' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      service.deleteDataSourceService('member-1', 'src-1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});
