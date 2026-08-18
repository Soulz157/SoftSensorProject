import { Test, TestingModule } from '@nestjs/testing';
import { FeaturePresetAuthorizedService } from './feature.preset.authorized.service';
import { PrismaService } from '@softsensor/prisma';
import { postMultipartToPython, postToPython } from '@/lib/python-client';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

jest.mock('@softsensor/common', () => ({
  AppException: class AppException extends Error {
    readonly statusCode: number;
    readonly type: string;

    constructor(body: { statusCode: number; message: string; type: string }) {
      super(body.message);
      this.statusCode = body.statusCode;
      this.type = body.type;
    }
  },
}));

jest.mock('@softsensor/prisma', () => ({
  PrismaService: class {},
}));

jest.mock('@/lib/python-client', () => ({
  postMultipartToPython: jest.fn(),
  postToPython: jest.fn(),
  PYTHON_TIMEOUT: { metadata: 30_000 },
}));

// ---------------------------------------------------------------------------
// Call shapes
//
// The mocks are typed rather than left as `jest.Mock`, so reading
// `mock.calls[0][0]` in an assertion stays type-safe. An `any` here would let a
// renamed field pass silently, which is exactly what these tests exist to catch.
// ---------------------------------------------------------------------------

interface WorkspaceFindFirstArgs {
  where: {
    id: string;
    deletedAt: null;
    OR?: Array<Record<string, unknown>>;
  };
}

interface ImportFindFirstArgs {
  where: { workspaceId: string; id?: string };
  orderBy: { createdAt: 'desc' };
}

interface ImportCreateArgs {
  data: {
    id: string;
    workspaceId: string;
    objectPrefix: string;
    presetCount: number;
    sdtaKey: string | null;
  };
}

interface PresetCreateManyArgs {
  data: Array<{
    presetId: string;
    unit: string;
    configNo: number;
    targetY: string;
    equationCount: number;
    incomplete: boolean;
  }>;
}

type TransactionCallback = (tx: unknown) => unknown;

interface PrismaMock {
  workspace: {
    findFirst: jest.Mock<Promise<unknown>, [WorkspaceFindFirstArgs]>;
  };
  featurePresetImport: {
    findFirst: jest.Mock<Promise<unknown>, [ImportFindFirstArgs]>;
    findUnique: jest.Mock<Promise<unknown>, [{ where: { id: string } }]>;
    create: jest.Mock<unknown, [ImportCreateArgs]>;
  };
  featurePreset: {
    createMany: jest.Mock<unknown, [PresetCreateManyArgs]>;
  };
  $transaction: jest.Mock<unknown, [TransactionCallback]>;
}

const uploadMock = postMultipartToPython as unknown as jest.Mock<
  Promise<unknown>,
  [string, FormData, number]
>;
const postMock = postToPython as unknown as jest.Mock<
  Promise<unknown>,
  [string, unknown, number]
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = { id: 'user-1', role: 'USER' } as Auth.UserPayload;
const ADMIN = { id: 'admin-1', role: 'ADMIN' } as Auth.UserPayload;

/** A minimal but VALID connector response — it must survive the zod parse. */
const PYTHON_RESPONSE = {
  file_name: 'templates.xlsx',
  key_prefix: 'feature-presets/ws-1/imp-1/',
  imported_at: '2026-08-05T00:00:00Z',
  sheet_count: 5,
  unit_count: 1,
  presets: [
    {
      preset_id: 's-204-no1',
      unit: 'S-204',
      config_no: 1,
      name: 'S-204 No.1',
      sampling_point: 'RS-204 Reflux',
      target_y: 'S204FBP.lab',
      object_key: 'feature-presets/ws-1/imp-1/s-204-no1.json',
      equation_count: 3,
      raw_tag_count: 13,
      required_base_tags: ['FI001.PV'],
      incomplete: false,
    },
  ],
  skipped_sheets: [],
  sdta: {
    object_key: 'feature-presets/ws-1/imp-1/sdta.json',
    range_count: 4,
    condition_count: 3,
  },
};

/** A Fastify request carrying one uploaded part. */
function requestWith(filename: string) {
  return {
    file: jest.fn().mockResolvedValue({
      filename,
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('xlsx-bytes')),
    }),
  } as never;
}

describe('FeaturePresetAuthorizedService', () => {
  let service: FeaturePresetAuthorizedService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      workspace: {
        findFirst: jest
          .fn<Promise<unknown>, [WorkspaceFindFirstArgs]>()
          .mockResolvedValue({ id: 'ws-1' }),
      },
      featurePresetImport: {
        findFirst: jest.fn<Promise<unknown>, [ImportFindFirstArgs]>(),
        findUnique: jest.fn<Promise<unknown>, [{ where: { id: string } }]>(),
        create: jest
          .fn<unknown, [ImportCreateArgs]>()
          .mockImplementation((args) => ({ ...args.data })),
      },
      featurePreset: { createMany: jest.fn<unknown, [PresetCreateManyArgs]>() },
      // Runs the callback against the same mock: the assertions care that both
      // writes happen inside ONE transaction, not that Prisma implements it.
      $transaction: jest
        .fn<unknown, [TransactionCallback]>()
        .mockImplementation((cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeaturePresetAuthorizedService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(FeaturePresetAuthorizedService);
    uploadMock.mockResolvedValue(PYTHON_RESPONSE);
  });

  afterEach(() => jest.clearAllMocks());

  // ── access ───────────────────────────────────────────────────────────────

  it('answers 404, not 403, when the caller cannot reach the workspace', async () => {
    // Confirming a workspace exists to someone who may not read it is itself a
    // leak, so the two cases must be indistinguishable.
    prisma.workspace.findFirst.mockResolvedValue(null);

    await expect(service.listPresets('ws-other', USER)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('scopes a non-admin to workspaces they own or belong to', async () => {
    await service.listPresets('ws-1', USER);

    const { where } = prisma.workspace.findFirst.mock.calls[0][0];
    expect(where.OR).toEqual([
      { ownerId: 'user-1' },
      { members: { some: { userId: 'user-1' } } },
    ]);
  });

  it('lets an ADMIN through without membership', async () => {
    // Must match assertDatasetAccess. If the two rules disagree, an admin can
    // create things in a workspace they then cannot read.
    await service.listPresets('ws-1', ADMIN);

    const { where } = prisma.workspace.findFirst.mock.calls[0][0];
    expect(where.OR).toBeUndefined();
  });

  // ── import ───────────────────────────────────────────────────────────────

  it('rejects a file that is not an Excel workbook before uploading it', async () => {
    await expect(
      service.importWorkbook('ws-1', USER, requestWith('notes.csv')),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no file part', async () => {
    const req = { file: jest.fn().mockResolvedValue(undefined) } as never;

    await expect(
      service.importWorkbook('ws-1', USER, req),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('sends a workspace- and import-scoped key prefix', async () => {
    // A flat prefix would make every import overwrite the last one.
    await service.importWorkbook('ws-1', USER, requestWith('templates.xlsx'));

    const form = uploadMock.mock.calls[0][1];
    const prefix = form.get('key_prefix');

    expect(prefix).toMatch(/^feature-presets\/ws-1\/[0-9a-f-]{36}\/$/);
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('writes the import and its presets in one transaction', async () => {
    await service.importWorkbook('ws-1', USER, requestWith('templates.xlsx'));

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.featurePresetImport.create).toHaveBeenCalledTimes(1);
    expect(prisma.featurePreset.createMany).toHaveBeenCalledTimes(1);

    const [preset] = prisma.featurePreset.createMany.mock.calls[0][0].data;
    expect(preset).toMatchObject({
      presetId: 's-204-no1',
      unit: 'S-204',
      configNo: 1,
      targetY: 'S204FBP.lab',
      equationCount: 3,
      incomplete: false,
    });
  });

  it('records the object prefix and sdta key the connector reported', async () => {
    await service.importWorkbook('ws-1', USER, requestWith('templates.xlsx'));

    const { data } = prisma.featurePresetImport.create.mock.calls[0][0];
    expect(data).toMatchObject({
      objectPrefix: 'feature-presets/ws-1/imp-1/',
      sdtaKey: 'feature-presets/ws-1/imp-1/sdta.json',
      presetCount: 1,
    });
  });

  it('rejects a connector response whose shape changed', async () => {
    // Parsed, not cast: this payload is written straight into two tables, so a
    // dropped field must fail the request rather than land as a null column.
    uploadMock.mockResolvedValue({
      ...PYTHON_RESPONSE,
      presets: [{ preset_id: 's-204-no1' }],
    });

    await expect(
      service.importWorkbook('ws-1', USER, requestWith('templates.xlsx')),
    ).rejects.toBeDefined();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ── list ─────────────────────────────────────────────────────────────────

  it('returns the newest import only, so re-uploads do not duplicate', async () => {
    prisma.featurePresetImport.findFirst.mockResolvedValue({
      id: 'imp-2',
      fileName: 'templates.xlsx',
      sheetCount: 5,
      skippedSheets: [],
      sdtaKey: null,
      createdAt: new Date('2026-08-05T00:00:00Z'),
      presets: [{ id: 'p1' }],
    });

    const result = await service.listPresets('ws-1', USER);

    expect(prisma.featurePresetImport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
    expect(result.data.import?.id).toBe('imp-2');
  });

  it('reads an older import when one is named', async () => {
    prisma.featurePresetImport.findFirst.mockResolvedValue(null);

    await service.listPresets('ws-1', USER, 'imp-1');

    const { where } = prisma.featurePresetImport.findFirst.mock.calls[0][0];
    expect(where).toEqual({ workspaceId: 'ws-1', id: 'imp-1' });
  });

  it('reports an empty workspace without failing', async () => {
    prisma.featurePresetImport.findFirst.mockResolvedValue(null);

    const result = await service.listPresets('ws-1', USER);

    expect(result.data.import).toBeNull();
    expect(result.data.presets).toEqual([]);
  });

  // ── SD&TA ────────────────────────────────────────────────────────────────

  describe('getSdtaDocument', () => {
    const SDTA_RESPONSE = {
      schema_version: 1,
      ranges: [{ from: '2022-09-01T00:00:00Z', to: '2023-01-01T00:00:00Z' }],
      conditions: [{ tag: 'GG203.PV', op: '<', value: 1700 }],
      source: {
        file_name: 'templates.xlsx',
        imported_at: '2026-08-05T00:00:00Z',
      },
    };

    it('answers 404 when the import does not exist', async () => {
      prisma.featurePresetImport.findUnique.mockResolvedValue(null);

      await expect(
        service.getSdtaDocument('imp-missing', USER),
      ).rejects.toMatchObject({ statusCode: 404 });

      expect(prisma.workspace.findFirst).not.toHaveBeenCalled();
    });

    it('answers 404, not 403, when the caller cannot reach the workspace', async () => {
      prisma.featurePresetImport.findUnique.mockResolvedValue({
        id: 'imp-1',
        workspaceId: 'ws-1',
        sdtaKey: 'feature-presets/ws-1/imp-1/sdta.json',
      });
      prisma.workspace.findFirst.mockResolvedValue(null);

      await expect(
        service.getSdtaDocument('imp-1', USER),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('answers 404 when the import has no SD&TA sheet', async () => {
      // Same status as "import not found" and "caller cannot reach it" —
      // deliberately: this route does not distinguish "bad id" from "nothing
      // to read here", and there is nothing sensitive in a null sdtaKey to
      // protect by picking a different code.
      prisma.featurePresetImport.findUnique.mockResolvedValue({
        id: 'imp-1',
        workspaceId: 'ws-1',
        sdtaKey: null,
      });

      await expect(
        service.getSdtaDocument('imp-1', USER),
      ).rejects.toMatchObject({ statusCode: 404 });

      expect(postMock).not.toHaveBeenCalled();
    });

    it('reads the stored key and returns the parsed cut config', async () => {
      prisma.featurePresetImport.findUnique.mockResolvedValue({
        id: 'imp-1',
        workspaceId: 'ws-1',
        sdtaKey: 'feature-presets/ws-1/imp-1/sdta.json',
      });
      postMock.mockResolvedValue(SDTA_RESPONSE);

      const result = await service.getSdtaDocument('imp-1', USER);

      expect(postMock).toHaveBeenCalledWith(
        '/v1/presets/sdta-document',
        { key: 'feature-presets/ws-1/imp-1/sdta.json' },
        expect.any(Number),
      );
      expect(result.data.ranges).toEqual(SDTA_RESPONSE.ranges);
      expect(result.data.conditions).toEqual(SDTA_RESPONSE.conditions);
    });

    it('rejects a connector response whose shape changed', async () => {
      // Parsed, not cast: this is the one guard against a silently truncated
      // cut config reaching Step 3.
      prisma.featurePresetImport.findUnique.mockResolvedValue({
        id: 'imp-1',
        workspaceId: 'ws-1',
        sdtaKey: 'feature-presets/ws-1/imp-1/sdta.json',
      });
      postMock.mockResolvedValue({ ranges: 'not-an-array' });

      await expect(
        service.getSdtaDocument('imp-1', USER),
      ).rejects.toBeDefined();
    });
  });
});
