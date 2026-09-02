import { AppException } from '@softsensor/common';
import { ModelServingAuthorizedService } from './model-serving.authorized.service';
import * as pythonClient from '@/lib/python-preprocess-client';

jest.mock('@/lib/python-preprocess-client');
// PYTHON_TIMEOUT re-declared as a literal, matching the convention
// model-run-launch.authorized.service.spec.ts already uses — this service
// only forwards `.serving` as a bare number, so its exact value has no
// bearing on what these tests assert.
jest.mock('@/lib/python-client', () => ({
  PYTHON_TIMEOUT: { test: 15_000, metadata: 300_000, serving: 15_000 },
  postToPython: jest.fn(),
}));

const mockedPresignRunObject = pythonClient.presignRunObject as jest.Mock;
const mockedGetRunManifest = pythonClient.getRunManifest as jest.Mock;
const mockedReadFeatureSpec = pythonClient.readFeatureSpec as jest.Mock;

const VERSION = {
  id: 'version-1',
  modelId: 'model-1',
  version: 2,
  stage: 'PRODUCTION',
  algorithm: 'ols',
  modelObjectKey: 'drafts/d1/runs/r1/model.joblib',
  modelChecksum: 'sha-abc',
  goldObjectKey: 'ds1/artifacts/a1/data_gold.parquet',
  featureSpecKey: 'ds1/artifacts/a1/feature_spec.json',
  frameworkVersions: { sklearn: '1.5.2' },
  imageDigest: 'scgc/soft-sensor-trainer@sha256:deadbeef',
  sourceRun: {
    targetY: 'S204FBP.lab',
    manifestKey: 'drafts/d1/runs/r1/run_manifest.json',
  },
};

function makePrisma(
  overrides: { version?: Record<string, unknown> | null } = {},
) {
  const version = overrides.version === undefined ? VERSION : overrides.version;
  return {
    modelVersion: {
      findFirst: jest.fn().mockResolvedValue(version),
      findMany: jest.fn().mockResolvedValue(version ? [version] : []),
    },
  } as unknown as ConstructorParameters<
    typeof ModelServingAuthorizedService
  >[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedPresignRunObject.mockResolvedValue({
    data_url: 'https://minio/model.joblib?sig=1',
    sidecar_urls: {},
    checksum: 'sha-abc',
    row_count: null,
    expires_at: '2026-09-02T00:00:00Z',
  });
  mockedGetRunManifest.mockResolvedValue({
    framework_versions: { sklearn: '1.5.2' },
    model_sha256: 'sha-abc',
    feature_columns: ['AI001A2.PV', 'FI001.PV'],
  });
  mockedReadFeatureSpec.mockResolvedValue({
    source_key: VERSION.goldObjectKey,
    feature_spec_key: VERSION.featureSpecKey,
    spec: {
      target_y: 'S204FBP.lab',
      target_scaled: false,
      scaling: [],
      scalingParams: {
        'AI001A2.PV': { min: 0, max: 1 },
        'FI001.PV': { min: 0, max: 1 },
      },
      derived_from_target: [],
    },
  });
});

describe('ModelServingAuthorizedService.getDescriptorService', () => {
  it('throws 404 when the model has no PRODUCTION version', async () => {
    const prisma = makePrisma({ version: null });
    const service = new ModelServingAuthorizedService(prisma);
    await expect(service.getDescriptorService('model-1')).rejects.toThrow(
      AppException,
    );
  });

  it('throws 422 when the run manifest has no feature_columns', async () => {
    mockedGetRunManifest.mockResolvedValueOnce({
      framework_versions: null,
      model_sha256: null,
      feature_columns: null,
    });
    const prisma = makePrisma();
    const service = new ModelServingAuthorizedService(prisma);
    await expect(service.getDescriptorService('model-1')).rejects.toThrow(
      /feature_columns/,
    );
  });

  it('throws 422 when the resolved feature_spec_key does not match the pinned key', async () => {
    mockedReadFeatureSpec.mockResolvedValueOnce({
      source_key: VERSION.goldObjectKey,
      feature_spec_key: 'some/other/feature_spec.json',
      spec: { scaling: [], scalingParams: {} },
    });
    const prisma = makePrisma();
    const service = new ModelServingAuthorizedService(prisma);
    await expect(service.getDescriptorService('model-1')).rejects.toThrow(
      /mismatch/,
    );
  });

  it('resolves a full descriptor on the happy path', async () => {
    const prisma = makePrisma();
    const service = new ModelServingAuthorizedService(prisma);
    const result = await service.getDescriptorService('model-1');

    expect(result.data).toMatchObject({
      modelId: 'model-1',
      versionId: 'version-1',
      version: 2,
      algorithm: 'ols',
      targetY: 'S204FBP.lab',
      modelUrl: 'https://minio/model.joblib?sig=1',
      modelChecksum: 'sha-abc',
      featureColumns: ['AI001A2.PV', 'FI001.PV'],
      scalers: {},
      targetScaled: false,
      derivedFromTarget: [],
      frameworkVersions: { sklearn: '1.5.2' },
      imageDigest: 'scgc/soft-sensor-trainer@sha256:deadbeef',
    });
    expect(mockedPresignRunObject).toHaveBeenCalledWith({
      source_key: VERSION.modelObjectKey,
    });
    expect(mockedReadFeatureSpec).toHaveBeenCalledWith(VERSION.goldObjectKey);
  });
});

describe('ModelServingAuthorizedService.listProductionVersionsService', () => {
  it('lists every PRODUCTION version across models', async () => {
    const prisma = makePrisma();
    const service = new ModelServingAuthorizedService(prisma);
    const result = await service.listProductionVersionsService();
    expect(result.data).toEqual([
      { modelId: 'model-1', versionId: 'version-1', version: 2 },
    ]);
  });
});
