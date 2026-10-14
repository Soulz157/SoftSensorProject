import { WriteBackConfigAuthorizedService } from './write-back-config.authorized.service';
import { ModelEvaluationAccessService } from './model-evaluation-access.service';
import { piResolveTags } from '@/lib/python-evaluation-client';
import { decryptSecret } from '@/lib/crypto';

jest.mock('@/lib/python-evaluation-client');
jest.mock('@/lib/crypto');

const mockedResolve = piResolveTags as jest.Mock;
const mockedDecrypt = decryptSecret as jest.Mock;

/** First argument of the first call, typed — jest's own `mock.calls` is `any`. */
function firstArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls[0] as unknown[])[0] as T;
}

beforeEach(() => {
  mockedDecrypt.mockReturnValue('s3cret');
});
afterEach(() => {
  jest.resetAllMocks();
});

const USER = { id: 'u1', role: 'USER' } as Auth.UserPayload;
const ADMIN = { id: 'a1', role: 'ADMIN' } as Auth.UserPayload;

const SOURCE = {
  id: 'src',
  name: 'Plant PI',
  type: 'aveva',
  host: 'https://pi.example',
  username: 'svc-softsensor',
  dbName: 'PIDB',
  config: null,
  secretCiphertext: 'v1:x:y:z',
};

const numeric = (name: string) => ({
  tagName: name,
  exists: true,
  pointType: 'Float32',
});

function build(
  over: {
    schedule?: unknown;
    source?: unknown;
    config?: unknown;
    ownsWorkspace?: boolean;
    memberRole?: 'OWNER' | 'STAFF' | 'VIEWER' | null;
    version?: unknown;
  } = {},
) {
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = {
    model: {
      findUnique: jest.fn().mockResolvedValue({ id: 'm1', workspaceId: 'w1' }),
    },
    workspace: {
      findFirst: jest
        .fn()
        .mockResolvedValue(over.ownsWorkspace ? { id: 'w1' } : null),
    },
    workspaceMember: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          over.memberRole === undefined || over.memberRole === null
            ? null
            : { role: over.memberRole, permissions: ['MONITORING_VIEW'] },
        ),
    },
    inferenceSchedule: {
      findUnique: jest.fn().mockResolvedValue(
        'schedule' in over
          ? over.schedule
          : {
              sourceId: 'src',
              fetchConfig: { intervalTime: '1m', baseTags: ['TI202.PV'] },
            },
      ),
    },
    dataSource: {
      findUnique: jest
        .fn()
        .mockResolvedValue('source' in over ? over.source : SOURCE),
    },
    modelVersion: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'version' in over
            ? over.version
            : { sourceRun: { targetY: 'LAB.Y' } },
        ),
    },
    modelWriteBackConfig: {
      findUnique: jest.fn().mockResolvedValue(over.config ?? null),
      upsert,
    },
  };
  const scheduler = {
    asFetchConfig: jest.fn().mockReturnValue({
      intervalTime: '1m',
      tags: ['TI202.PV', 'LAB.Y'],
    }),
  };
  const access = new ModelEvaluationAccessService(prisma as never);
  const service = new WriteBackConfigAuthorizedService(
    prisma as never,
    access,
    scheduler as never,
  );
  return { service, prisma, upsert, access };
}

const PUT = { predictionTag: 'OUT.PRED', labTag: 'OUT.LAB' };

describe('WriteBackConfigAuthorizedService.putConfigService', () => {
  it('verifies both tags in PI, then saves against the SCHEDULE source', async () => {
    mockedResolve.mockResolvedValue({
      count: 2,
      found: 2,
      tags: [numeric('OUT.PRED'), numeric('OUT.LAB')],
    });
    const { service, upsert } = build({ ownsWorkspace: true });

    await service.putConfigService('m1', PUT, USER);

    expect(firstArg<{ tag_list: string[] }>(mockedResolve).tag_list).toEqual([
      'OUT.PRED',
      'OUT.LAB',
    ]);
    expect(
      firstArg<{ credentials: Record<string, unknown> }>(mockedResolve)
        .credentials,
    ).toEqual({
      api_server: 'https://pi.example',
      pi_server: 'PIDB',
      user: 'svc-softsensor',
      password: 's3cret',
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = firstArg<{
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }>(upsert);
    expect(arg.create).toEqual({
      modelId: 'm1',
      sourceId: 'src',
      predictionTag: 'OUT.PRED',
      labTag: 'OUT.LAB',
      updatedById: 'u1',
    });
  });

  it('trims, and a blank slot is stored as null without asking PI about it', async () => {
    mockedResolve.mockResolvedValue({
      count: 1,
      found: 1,
      tags: [numeric('OUT.PRED')],
    });
    const { service, upsert } = build({ ownsWorkspace: true });

    await service.putConfigService(
      'm1',
      { predictionTag: '  OUT.PRED ', labTag: '   ' },
      USER,
    );

    expect(firstArg<{ tag_list: string[] }>(mockedResolve).tag_list).toEqual([
      'OUT.PRED',
    ]);
    expect(
      firstArg<{ create: { labTag: string | null } }>(upsert).create.labTag,
    ).toBeNull();
  });

  it('clearing both slots saves without calling PI', async () => {
    const { service, upsert } = build({ ownsWorkspace: true });
    await service.putConfigService(
      'm1',
      { predictionTag: null, labTag: null },
      USER,
    );
    expect(mockedResolve).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalled();
  });

  describe('who may save', () => {
    it.each([
      ['a global ADMIN', ADMIN, {}],
      ['the workspace owner', USER, { ownsWorkspace: true }],
      ['an OWNER member', USER, { memberRole: 'OWNER' as const }],
    ])('allows %s', async (_label, user, over) => {
      mockedResolve.mockResolvedValue({
        count: 2,
        found: 2,
        tags: [numeric('OUT.PRED'), numeric('OUT.LAB')],
      });
      const { service, upsert } = build(over);
      await service.putConfigService('m1', PUT, user);
      expect(upsert).toHaveBeenCalled();
    });

    it.each([
      ['STAFF', { memberRole: 'STAFF' as const }],
      ['a VIEWER with a monitoring grant', { memberRole: 'VIEWER' as const }],
      ['a non-member', {}],
    ])('refuses %s with 403 before touching anything', async (_l, over) => {
      const { service, upsert, prisma } = build(over);
      await expect(
        service.putConfigService('m1', PUT, USER),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(prisma.inferenceSchedule.findUnique).not.toHaveBeenCalled();
      expect(mockedResolve).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    });

    it('404 for an unknown model', async () => {
      const { service, prisma } = build({ ownsWorkspace: true });
      prisma.model.findUnique.mockResolvedValue(null);
      await expect(
        service.putConfigService('m1', PUT, USER),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('refusals (nothing saved)', () => {
    const refused = async (
      over: Parameters<typeof build>[0],
      dto = PUT,
    ): Promise<unknown> => {
      const { service, upsert } = build({ ownsWorkspace: true, ...over });
      const err: unknown = await service
        .putConfigService('m1', dto, USER)
        .then(() => null)
        .catch((e: unknown) => e);
      expect(upsert).not.toHaveBeenCalled();
      return err;
    };

    it('the lab target as an output tag', async () => {
      expect(
        await refused({}, { ...PUT, predictionTag: 'lab.y' }),
      ).toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/lab target/) as string,
      });
      expect(mockedResolve).not.toHaveBeenCalled();
    });

    it('an input tag as an output tag', async () => {
      expect(await refused({}, { ...PUT, labTag: 'TI202.PV' })).toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/input tags/) as string,
      });
    });

    it('the same tag for both', async () => {
      expect(
        await refused({}, { predictionTag: 'OUT.X', labTag: 'out.x' }),
      ).toMatchObject({ statusCode: 422 });
    });

    it('no schedule', async () => {
      expect(await refused({ schedule: null })).toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/no production data source/) as string,
      });
    });

    it('a non-PI source', async () => {
      expect(
        await refused({ source: { ...SOURCE, type: 'sql' } }),
      ).toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/targets PI/) as string,
      });
      expect(mockedResolve).not.toHaveBeenCalled();
    });

    it('a tag PI does not know', async () => {
      mockedResolve.mockResolvedValue({
        count: 2,
        found: 1,
        tags: [numeric('OUT.PRED'), { tagName: 'OUT.LAB', exists: false }],
      });
      expect(await refused({})).toMatchObject({
        statusCode: 422,
        message: 'Tag "OUT.LAB" was not found in PI.',
      });
    });

    it('a non-numeric point', async () => {
      mockedResolve.mockResolvedValue({
        count: 2,
        found: 2,
        tags: [
          { tagName: 'OUT.PRED', exists: true, pointType: 'Digital' },
          numeric('OUT.LAB'),
        ],
      });
      expect(await refused({})).toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/Digital point/) as string,
      });
    });

    it('a point type PI did not report is not assumed numeric', async () => {
      mockedResolve.mockResolvedValue({
        count: 2,
        found: 2,
        tags: [{ tagName: 'OUT.PRED', exists: true }, numeric('OUT.LAB')],
      });
      expect(await refused({})).toMatchObject({ statusCode: 422 });
    });

    it('PI unreachable: refuses rather than saving an unverified config', async () => {
      mockedResolve.mockRejectedValue(new Error('timed out'));
      expect(await refused({})).toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(
          /nothing was saved: timed out/,
        ) as string,
      });
    });
  });

  it('matches PI tag names case-insensitively when verifying', async () => {
    mockedResolve.mockResolvedValue({
      count: 1,
      found: 1,
      tags: [numeric('out.pred')],
    });
    const { service, upsert } = build({ ownsWorkspace: true });
    await service.putConfigService(
      'm1',
      { predictionTag: 'OUT.PRED', labTag: null },
      USER,
    );
    expect(upsert).toHaveBeenCalled();
  });
});

describe('WriteBackConfigAuthorizedService.getConfigService', () => {
  const stored = {
    sourceId: 'src',
    predictionTag: 'OUT.PRED',
    labTag: null,
    updatedAt: new Date('2026-10-14T01:00:00Z'),
  };

  it('reports the config, the PI account a write would use, and canWrite', async () => {
    const { service } = build({ ownsWorkspace: true, config: stored });
    const { data } = await service.getConfigService('m1', USER);

    expect(data.config).toEqual({
      sourceId: 'src',
      predictionTag: 'OUT.PRED',
      labTag: null,
      updatedAt: '2026-10-14T01:00:00.000Z',
    });
    expect(data.source).toEqual({
      id: 'src',
      name: 'Plant PI',
      type: 'aveva',
      piAccount: 'svc-softsensor',
      writable: true,
    });
    expect(data.canWrite).toBe(true);
    expect(data.targetTag).toBe('LAB.Y');
    expect(data.sourceChanged).toBe(false);
  });

  it('never returns the password or ciphertext', async () => {
    const { service } = build({ ownsWorkspace: true, config: stored });
    const json = JSON.stringify(await service.getConfigService('m1', USER));
    expect(json).not.toMatch(/s3cret|secretCiphertext|v1:x:y:z/);
  });

  it('lets a VIEWER with the monitoring grant READ but reports canWrite false', async () => {
    const { service } = build({ memberRole: 'VIEWER', config: stored });
    const { data } = await service.getConfigService('m1', USER);
    expect(data.canWrite).toBe(false);
    expect(data.config?.predictionTag).toBe('OUT.PRED');
  });

  it('reports unconfigured as config: null', async () => {
    const { service } = build({ ownsWorkspace: true });
    const { data } = await service.getConfigService('m1', USER);
    expect(data.config).toBeNull();
  });

  it('flags a schedule re-pointed after the config was saved', async () => {
    const { service } = build({
      ownsWorkspace: true,
      config: { ...stored, sourceId: 'old-src' },
      schedule: { sourceId: 'src', fetchConfig: {} },
    });
    const { data } = await service.getConfigService('m1', USER);
    expect(data.sourceChanged).toBe(true);
  });

  it('marks a non-PI source as not writable', async () => {
    const { service } = build({
      ownsWorkspace: true,
      source: { ...SOURCE, type: 'sql' },
    });
    const { data } = await service.getConfigService('m1', USER);
    expect(data.source?.writable).toBe(false);
  });

  it('refuses a user with no access at all', async () => {
    const { service } = build({});
    await expect(service.getConfigService('m1', USER)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
