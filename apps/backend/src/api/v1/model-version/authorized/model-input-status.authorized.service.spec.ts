import { ModelInputStatusAuthorizedService } from './model-input-status.authorized.service';
import * as pythonClient from '@/lib/python-preprocess-client';

jest.mock('@/lib/python-preprocess-client');

const mockedGetRunManifest = pythonClient.getRunManifest as jest.Mock;
const mockedReadFeatureSpec = pythonClient.readFeatureSpec as jest.Mock;

const ADMIN: Auth.UserPayload = {
  id: 'u1',
  role: 'ADMIN',
} as Auth.UserPayload;

const VERSION = {
  id: 'v1',
  goldObjectKey: 'models/m1/versions/v1/gold/data.parquet',
  sourceDatasetId: 'ds-1',
  sourceRun: { manifestKey: 'runs/run-1/run_manifest.json' },
};

function makePrisma(
  overrides: {
    model?: Record<string, unknown> | null;
    version?: Record<string, unknown> | null;
    schedule?: Record<string, unknown> | null;
    dataset?: Record<string, unknown> | null;
  } = {},
) {
  const model =
    overrides.model === undefined
      ? { id: 'm1', workspaceId: 'ws-1' }
      : overrides.model;
  const version = overrides.version === undefined ? VERSION : overrides.version;
  const schedule =
    overrides.schedule === undefined
      ? { sourceId: 'src-1' }
      : overrides.schedule;
  const dataset =
    overrides.dataset === undefined
      ? { sourceIds: ['src-1'] }
      : overrides.dataset;

  return {
    model: { findUnique: jest.fn().mockResolvedValue(model) },
    modelVersion: { findFirst: jest.fn().mockResolvedValue(version) },
    inferenceSchedule: { findFirst: jest.fn().mockResolvedValue(schedule) },
    dataset: { findUnique: jest.fn().mockResolvedValue(dataset) },
    workspace: { findFirst: jest.fn().mockResolvedValue(null) },
    workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
  };
}

/** `tagsCurrentById` returns the connect service's own `ok()` envelope. */
function makeConnect(tags: Array<Record<string, unknown>>) {
  return {
    tagsCurrentById: jest.fn().mockResolvedValue({ data: { tags } }),
  };
}

function build(
  prisma: ReturnType<typeof makePrisma>,
  connect: { tagsCurrentById: jest.Mock },
) {
  return new ModelInputStatusAuthorizedService(
    prisma as never,
    connect as never,
  );
}

type StatusData = {
  features: Array<{
    column: string;
    status: string;
    reason?: string;
    failingSources?: string[];
    value?: number | string | null;
  }>;
  unavailableReason: string | null;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetRunManifest.mockResolvedValue({ feature_columns: ['TI-101'] });
  mockedReadFeatureSpec.mockResolvedValue({ spec: { features: [] } });
});

describe('ModelInputStatusAuthorizedService.getInputStatusService', () => {
  it('maps PI isGood:true to Good and carries the live reading through', async () => {
    const prisma = makePrisma({});
    const connect = makeConnect([
      {
        tag_name: 'TI-101',
        value: 190.4,
        timestamp: '2026-09-15T00:00:00Z',
        isGood: true,
      },
    ]);
    const result = await build(prisma, connect).getInputStatusService(
      'm1',
      ADMIN,
    );
    const data = result.data as StatusData;

    expect(data.features[0]).toMatchObject({
      column: 'TI-101',
      status: 'Good',
      value: 190.4,
    });
    expect(data.unavailableReason).toBeNull();
  });

  it('maps PI isGood:false to Bad — the real reading, never a 0.0 hole', async () => {
    const prisma = makePrisma({});
    // A Bad tag still has a value on the wire. The whole reason this reads
    // from PI rather than the pipeline is that the pipeline would have
    // replaced it with the 0.0 MISSING_VALUE placeholder.
    const connect = makeConnect([
      { tag_name: 'TI-101', value: 11.3, isGood: false },
    ]);
    const data = (
      await build(prisma, connect).getInputStatusService('m1', ADMIN)
    ).data as StatusData;

    expect(data.features[0].status).toBe('Bad');
    expect(data.features[0].value).toBe(11.3);
    expect(data.features[0].value).not.toBe(0);
  });

  it('maps a questionable reading to Questionable, distinct from Bad', async () => {
    const prisma = makePrisma({});
    const connect = makeConnect([
      { tag_name: 'TI-101', value: 5, isGood: true, questionable: true },
    ]);
    const data = (
      await build(prisma, connect).getInputStatusService('m1', ADMIN)
    ).data as StatusData;

    expect(data.features[0].status).toBe('Questionable');
  });

  it('reports UNKNOWN, never Good, for a tag PI returned nothing for', async () => {
    const prisma = makePrisma({});
    const connect = makeConnect([]); // PI answered, but not about this tag
    const data = (
      await build(prisma, connect).getInputStatusService('m1', ADMIN)
    ).data as StatusData;

    expect(data.features[0].status).toBe('UNKNOWN');
    expect(data.features[0].reason).toMatch(/no current reading/i);
  });

  it('marks a derived feature Bad when a source tag is Bad, and NAMES the failing source', async () => {
    mockedGetRunManifest.mockResolvedValue({
      feature_columns: ['FI001.PV', 'FI003.PV', 'Spgr_in_feed'],
    });
    mockedReadFeatureSpec.mockResolvedValue({
      spec: {
        features: [
          {
            name: 'Spgr_in_feed',
            kind: 'formula',
            config: {
              expr: 'c0*c1',
              vars: { c0: 'FI001.PV', c1: 'FI003.PV' },
            },
          },
        ],
      },
    });
    const prisma = makePrisma({});
    const connect = makeConnect([
      { tag_name: 'FI001.PV', value: 190, isGood: true },
      { tag_name: 'FI003.PV', value: 12, isGood: false },
    ]);
    const data = (
      await build(prisma, connect).getInputStatusService('m1', ADMIN)
    ).data as StatusData;

    const derived = data.features.find((f) => f.column === 'Spgr_in_feed');
    expect(derived?.status).toBe('Bad');
    // The actionable half — at six source tags "Bad" alone says nothing.
    expect(derived?.failingSources).toEqual(['FI003.PV']);
    expect(derived?.reason).toContain('FI003.PV');
    // The healthy source is still reported Good on its own row.
    expect(data.features.find((f) => f.column === 'FI001.PV')?.status).toBe(
      'Good',
    );
  });

  it('queries PI for the BASE tag behind a derived column, not the derived name itself', async () => {
    mockedGetRunManifest.mockResolvedValue({
      feature_columns: ['TI-101__lag3'],
    });
    mockedReadFeatureSpec.mockResolvedValue({
      spec: {
        features: [
          {
            name: 'TI-101__lag3',
            kind: 'lag',
            config: { tag: 'TI-101', k: 3 },
          },
        ],
      },
    });
    const prisma = makePrisma({});
    const connect = makeConnect([
      { tag_name: 'TI-101', value: 1, isGood: true },
    ]);
    await build(prisma, connect).getInputStatusService('m1', ADMIN);

    // PI has never heard of `TI-101__lag3` — asking for it would return
    // nothing and the column would read UNKNOWN forever.
    expect(connect.tagsCurrentById).toHaveBeenCalledWith('u1', 'src-1', {
      tagList: ['TI-101'],
    });
  });

  it('reports unavailableReason, never throws, when the PI call fails', async () => {
    const prisma = makePrisma({});
    const connect = {
      tagsCurrentById: jest
        .fn()
        .mockRejectedValue(new Error('PI Web API error')),
    };
    const result = await build(prisma, connect).getInputStatusService(
      'm1',
      ADMIN,
    );
    const data = result.data as StatusData;

    expect(result.statusCode).toBe(200);
    expect(data.unavailableReason).toMatch(/PI Web API error/);
    expect(data.features).toEqual([]);
  });

  it('refuses to guess a source when there is no schedule and the dataset has several', async () => {
    const prisma = makePrisma({
      schedule: null,
      dataset: { sourceIds: ['src-1', 'src-2'] },
    });
    const connect = makeConnect([]);
    const data = (
      await build(prisma, connect).getInputStatusService('m1', ADMIN)
    ).data as StatusData;

    expect(data.unavailableReason).toMatch(/no single source/i);
    expect(connect.tagsCurrentById).not.toHaveBeenCalled();
  });

  it("falls back to the dataset's single source when the model has no schedule", async () => {
    const prisma = makePrisma({
      schedule: null,
      dataset: { sourceIds: ['src-only'] },
    });
    const connect = makeConnect([
      { tag_name: 'TI-101', value: 1, isGood: true },
    ]);
    await build(prisma, connect).getInputStatusService('m1', ADMIN);

    expect(connect.tagsCurrentById).toHaveBeenCalledWith(
      'u1',
      'src-only',
      expect.anything(),
    );
  });

  it('says so honestly when the run recorded no feature columns', async () => {
    mockedGetRunManifest.mockResolvedValue({ feature_columns: [] });
    const prisma = makePrisma({});
    const connect = makeConnect([]);
    const data = (
      await build(prisma, connect).getInputStatusService('m1', ADMIN)
    ).data as StatusData;

    expect(data.unavailableReason).toMatch(
      /did not record its feature columns/,
    );
    expect(connect.tagsCurrentById).not.toHaveBeenCalled();
  });
});
