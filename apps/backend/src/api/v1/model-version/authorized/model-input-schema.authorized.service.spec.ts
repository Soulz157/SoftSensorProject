import { AppException } from '@softsensor/common';
import { ModelInputSchemaAuthorizedService } from './model-input-schema.authorized.service';
import * as pythonClient from '@/lib/python-preprocess-client';

jest.mock('@/lib/python-preprocess-client');

const mockedGetRunManifest = pythonClient.getRunManifest as jest.Mock;
const mockedReadFeatureSpec = pythonClient.readFeatureSpec as jest.Mock;

/**
 * The Input Data tab's read of a saved Model's trained X/Y schema —
 * verifies the three properties the service exists to guarantee that
 * `ModelServingAuthorizedService.buildDescriptor` (the machine-serving
 * twin) deliberately does NOT: PRODUCTION-preferred-but-not-required
 * version resolution, a legacy manifest never throwing, and VIEWER still
 * being rejected (matching the sibling `/predictions` and `/drift` reads).
 */

const EDITOR_USER = { id: 'user-1', role: 'USER' } as Auth.UserPayload;
const ADMIN_USER = { id: 'admin-1', role: 'ADMIN' } as Auth.UserPayload;

const PRODUCTION_VERSION = {
  id: 'version-prod',
  version: 2,
  stage: 'PRODUCTION',
  goldObjectKey: 'ds-1/artifacts/gold-2/data_gold.parquet',
  sourceRun: {
    targetY: 'TI-900.PV',
    manifestKey: 'drafts/draft-1/runs/run-2/run_manifest.json',
  },
};

const STAGING_VERSION = {
  id: 'version-staging',
  version: 1,
  stage: 'STAGING',
  goldObjectKey: 'ds-1/artifacts/gold-1/data_gold.parquet',
  sourceRun: {
    targetY: 'TI-900.PV',
    manifestKey: 'drafts/draft-1/runs/run-1/run_manifest.json' as string | null,
  },
};

function buildPrisma(options: {
  model?: { id: string; workspaceId: string } | null;
  workspaceOwned?: boolean;
  member?: { role: string } | null;
  productionVersion?: typeof PRODUCTION_VERSION | null;
  latestVersion?: typeof STAGING_VERSION | null;
}) {
  const {
    model = { id: 'model-1', workspaceId: 'ws-1' },
    workspaceOwned = true,
    member = null,
    productionVersion = null,
    latestVersion = STAGING_VERSION,
  } = options;

  return {
    model: {
      findUnique: jest.fn().mockResolvedValue(model),
    },
    workspace: {
      findFirst: jest
        .fn()
        .mockResolvedValue(workspaceOwned ? { id: 'ws-1' } : null),
    },
    workspaceMember: {
      findFirst: jest.fn().mockResolvedValue(member),
    },
    modelVersion: {
      findFirst: jest
        .fn()
        .mockImplementation((args: { where: Record<string, unknown> }) =>
          Promise.resolve(
            'stage' in args.where ? productionVersion : latestVersion,
          ),
        ),
    },
  };
}

function buildService(prisma: ReturnType<typeof buildPrisma>) {
  return new ModelInputSchemaAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof ModelInputSchemaAuthorizedService
    >[0],
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetRunManifest.mockResolvedValue({
    framework_versions: null,
    feature_columns: ['TI-101.PV', 'PI-204.PV', 'FC-310.PV'],
  });
  mockedReadFeatureSpec.mockResolvedValue({
    source_key: 'x',
    feature_spec_key: 'x',
    spec: { scalingParams: { 'TI-101.PV': { min: 0, max: 100 } } },
  });
});

describe('ModelInputSchemaAuthorizedService.getInputSchemaService', () => {
  it('prefers the PRODUCTION version over a later STAGING one', async () => {
    const prisma = buildPrisma({
      productionVersion: PRODUCTION_VERSION,
      latestVersion: STAGING_VERSION,
    });
    const service = buildService(prisma);

    const result = await service.getInputSchemaService('model-1', EDITOR_USER);

    expect(result.data.versionId).toBe('version-prod');
    expect(result.data.stage).toBe('PRODUCTION');
  });

  it('falls back to the latest version when there is no PRODUCTION version', async () => {
    const prisma = buildPrisma({
      productionVersion: null,
      latestVersion: STAGING_VERSION,
    });
    const service = buildService(prisma);

    const result = await service.getInputSchemaService('model-1', EDITOR_USER);

    expect(result.data.versionId).toBe('version-staging');
    expect(result.data.stage).toBe('STAGING');
  });

  it('404s when the model has no version at all', async () => {
    const prisma = buildPrisma({
      productionVersion: null,
      latestVersion: null,
    });
    const service = buildService(prisma);

    await expect(
      service.getInputSchemaService('model-1', EDITOR_USER),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('403s a VIEWER, matching the /predictions and /drift reads', async () => {
    const prisma = buildPrisma({
      workspaceOwned: false,
      member: { role: 'VIEWER' },
      productionVersion: null,
      latestVersion: STAGING_VERSION,
    });
    const service = buildService(prisma);

    await expect(
      service.getInputSchemaService('model-1', EDITOR_USER),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows ADMIN regardless of workspace membership', async () => {
    const prisma = buildPrisma({
      workspaceOwned: false,
      member: null,
      productionVersion: null,
      latestVersion: STAGING_VERSION,
    });
    const service = buildService(prisma);

    const result = await service.getInputSchemaService('model-1', ADMIN_USER);

    expect(result.data.versionId).toBe('version-staging');
  });

  it('returns featureColumns: null with a reason when manifestKey is unset', async () => {
    const prisma = buildPrisma({
      productionVersion: null,
      latestVersion: {
        ...STAGING_VERSION,
        sourceRun: { ...STAGING_VERSION.sourceRun, manifestKey: null },
      },
    });
    const service = buildService(prisma);

    const result = await service.getInputSchemaService('model-1', EDITOR_USER);

    expect(result.data.featureColumns).toBeNull();
    expect(result.data.unavailableReason).toMatch(/manifest/i);
    expect(mockedGetRunManifest).not.toHaveBeenCalled();
  });

  it('returns featureColumns: null with a reason when the manifest read throws — never fails the whole read', async () => {
    mockedGetRunManifest.mockRejectedValue(new Error('python timeout'));
    const prisma = buildPrisma({
      productionVersion: null,
      latestVersion: STAGING_VERSION,
    });
    const service = buildService(prisma);

    const result = await service.getInputSchemaService('model-1', EDITOR_USER);

    expect(result.data.featureColumns).toBeNull();
    expect(result.data.unavailableReason).toContain('python timeout');
    expect(result.data.targetY).toBe('TI-900.PV');
  });

  it('returns featureColumns: null with a reason when the manifest has none recorded (legacy run)', async () => {
    mockedGetRunManifest.mockResolvedValue({
      framework_versions: null,
      feature_columns: null,
    });
    const prisma = buildPrisma({
      productionVersion: null,
      latestVersion: STAGING_VERSION,
    });
    const service = buildService(prisma);

    const result = await service.getInputSchemaService('model-1', EDITOR_USER);

    expect(result.data.featureColumns).toBeNull();
    expect(result.data.unavailableReason).toMatch(/feature columns/i);
  });

  it('returns scalingParams: null when the feature spec read throws, without dropping featureColumns', async () => {
    mockedReadFeatureSpec.mockRejectedValue(new Error('spec unavailable'));
    const prisma = buildPrisma({
      productionVersion: null,
      latestVersion: STAGING_VERSION,
    });
    const service = buildService(prisma);

    const result = await service.getInputSchemaService('model-1', EDITOR_USER);

    expect(result.data.scalingParams).toBeNull();
    expect(result.data.featureColumns).toEqual([
      'TI-101.PV',
      'PI-204.PV',
      'FC-310.PV',
    ]);
  });

  it('404s when the model does not exist', async () => {
    const prisma = buildPrisma({ model: null });
    const service = buildService(prisma);

    await expect(
      service.getInputSchemaService('missing', EDITOR_USER),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// Sanity: AppException is thrown, not a Nest built-in.
describe('errors are AppException', () => {
  it('404 is an AppException instance', async () => {
    const prisma = buildPrisma({ model: null });
    const service = buildService(prisma);

    await expect(
      service.getInputSchemaService('missing', EDITOR_USER),
    ).rejects.toBeInstanceOf(AppException);
  });
});
