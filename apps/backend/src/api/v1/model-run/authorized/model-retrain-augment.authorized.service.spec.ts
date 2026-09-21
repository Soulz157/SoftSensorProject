import { ModelRetrainAugmentAuthorizedService } from './model-retrain-augment.authorized.service';
import * as pythonClient from '@/lib/python-preprocess-client';

/**
 * MODEL-SERVE-015-T02/T03. `assertCompatible` — every refusal case, proven
 * to fire before any expensive work (no Python call, no job row) — and
 * `buildCombinedArtifact`'s own transaction shape.
 *
 * Constructed by hand, matching `model-retrain.authorized.service.spec.ts`
 * next door. Python is mocked at the module boundary (`fetchArtifactMetadata`
 * /`combineForRetrain`) — this suite proves NestJS's own orchestration and
 * validation, not the Python transform (covered by
 * `test_artifact_service_combine_for_retrain.py`).
 */
jest.mock('@/lib/python-preprocess-client');

describe('ModelRetrainAugmentAuthorizedService', () => {
  const USER = { id: 'user-1', role: 'ADMIN' } as never;

  const BASE_FINAL = {
    id: 'base-final-1',
    datasetId: 'dataset-base',
    type: 'FINAL',
    objectKey: 'dataset-base/artifacts/base-final-1/data.parquet',
    checksum: 'base-sha',
    parentArtifactId: 'base-gold-1',
  };

  const SOURCE_RUN = {
    goldArtifactId: 'base-final-1',
    featureSpecKey: 'dataset-base/artifacts/base-final-1/feature_spec.json',
    targetY: 'TI-101',
    splitSpec: {
      method: 'chronological',
      ratio: 0.8,
      cut_timestamp: '2026-01-16T00:00:00.000Z',
    },
  };

  const NEW_VERSION = {
    id: 'version-new-1',
    versionNumber: 2,
    artifactId: 'new-final-1',
  };

  const NEW_FINAL = {
    id: 'new-final-1',
    type: 'FINAL',
    objectKey: 'dataset-new/artifacts/new-final-1/data.parquet',
    checksum: 'new-sha',
    objectReclaimedAt: null as Date | null,
    parentArtifactId: 'new-silver-1',
  };

  const NEW_SILVER = {
    id: 'new-silver-1',
    type: 'SILVER',
    objectKey: 'dataset-new/artifacts/new-silver-1/data_silver.parquet',
    parentArtifactId: null,
  };

  function makePrisma(
    overrides: {
      datasetVersion?: Record<string, unknown> | null;
      artifacts?: Record<string, Record<string, unknown> | null>;
    } = {},
  ) {
    const artifacts = overrides.artifacts ?? {
      'base-final-1': BASE_FINAL,
      'new-final-1': NEW_FINAL,
      'new-silver-1': NEW_SILVER,
    };
    return {
      datasetArtifact: {
        findUnique: jest
          .fn()
          .mockImplementation((args: { where: { id: string } }) =>
            Promise.resolve(artifacts[args.where.id] ?? null),
          ),
      },
      datasetVersion: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            overrides.datasetVersion === undefined
              ? NEW_VERSION
              : overrides.datasetVersion,
          ),
        findFirst: jest.fn().mockResolvedValue({ id: 'version-base-1' }),
      },
    } as never;
  }

  function mockMetadata(
    baseTags: string[],
    newTags: string[],
    newStartTime: string | null = '2026-01-26T00:00:00.000Z',
  ) {
    (pythonClient.fetchArtifactMetadata as jest.Mock).mockImplementation(
      (sourceKey: string) => {
        if (sourceKey === BASE_FINAL.objectKey) {
          return Promise.resolve({
            tags: baseTags,
            column_count: baseTags.length,
            row_count: 20,
            start_time: '2026-01-01T00:00:00.000Z',
            end_time: '2026-01-20T00:00:00.000Z',
          });
        }
        return Promise.resolve({
          tags: newTags,
          column_count: newTags.length,
          row_count: 5,
          start_time: newStartTime,
          end_time: '2026-01-30T00:00:00.000Z',
        });
      },
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('assertCompatible', () => {
    it('refuses when the source run has no computed cut_timestamp', async () => {
      const service = new ModelRetrainAugmentAuthorizedService(makePrisma());
      await expect(
        service.assertCompatible(
          { ...SOURCE_RUN, splitSpec: { method: 'chronological', ratio: 0.8 } },
          'version-new-1',
        ),
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(pythonClient.fetchArtifactMetadata).not.toHaveBeenCalled();
    });

    it('refuses when the incumbent has no recorded feature spec', async () => {
      const service = new ModelRetrainAugmentAuthorizedService(makePrisma());
      await expect(
        service.assertCompatible(
          { ...SOURCE_RUN, featureSpecKey: null },
          'version-new-1',
        ),
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(pythonClient.fetchArtifactMetadata).not.toHaveBeenCalled();
    });

    it('refuses when the dataset version has no committed FINAL artifact', async () => {
      const service = new ModelRetrainAugmentAuthorizedService(
        makePrisma({ datasetVersion: { ...NEW_VERSION, artifactId: null } }),
      );
      await expect(
        service.assertCompatible(SOURCE_RUN, 'version-new-1'),
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(pythonClient.fetchArtifactMetadata).not.toHaveBeenCalled();
    });

    it('refuses when the new artifact has been reclaimed', async () => {
      const service = new ModelRetrainAugmentAuthorizedService(
        makePrisma({
          artifacts: {
            'base-final-1': BASE_FINAL,
            'new-final-1': { ...NEW_FINAL, objectReclaimedAt: new Date() },
            'new-silver-1': NEW_SILVER,
          },
        }),
      );
      await expect(
        service.assertCompatible(SOURCE_RUN, 'version-new-1'),
      ).rejects.toMatchObject({ statusCode: 422 });
    });

    it('refuses when the new dataset has no SILVER ancestor (never cleaned)', async () => {
      const service = new ModelRetrainAugmentAuthorizedService(
        makePrisma({
          artifacts: {
            'base-final-1': BASE_FINAL,
            // FINAL points straight at nothing — no SILVER in the chain.
            'new-final-1': { ...NEW_FINAL, parentArtifactId: null },
          },
        }),
      );
      await expect(
        service.assertCompatible(SOURCE_RUN, 'version-new-1'),
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(pythonClient.fetchArtifactMetadata).not.toHaveBeenCalled();
    });

    it('refuses when the target is absent from the new dataset', async () => {
      mockMetadata(['TI-101', 'PT-201'], ['PT-201']);
      const service = new ModelRetrainAugmentAuthorizedService(makePrisma());
      await expect(
        service.assertCompatible(SOURCE_RUN, 'version-new-1'),
      ).rejects.toMatchObject({ statusCode: 422 });
    });

    it('refuses when the two datasets disagree on tag columns', async () => {
      mockMetadata(['TI-101', 'PT-201'], ['TI-101', 'FT-999']);
      const service = new ModelRetrainAugmentAuthorizedService(makePrisma());
      await expect(
        service.assertCompatible(SOURCE_RUN, 'version-new-1'),
      ).rejects.toMatchObject(
        expect.objectContaining({
          statusCode: 422,
          message: expect.stringContaining('PT-201'),
        }),
      );
    });

    it('refuses when the new dataset starts at or before the incumbent split boundary', async () => {
      mockMetadata(['TI-101'], ['TI-101'], '2026-01-16T00:00:00.000Z');
      const service = new ModelRetrainAugmentAuthorizedService(makePrisma());
      await expect(
        service.assertCompatible(SOURCE_RUN, 'version-new-1'),
      ).rejects.toMatchObject(
        expect.objectContaining({
          statusCode: 422,
          message: expect.stringContaining('uncontaminated'),
        }),
      );
    });

    it('resolves a full context on a compatible pair', async () => {
      mockMetadata(['TI-101'], ['TI-101']);
      const service = new ModelRetrainAugmentAuthorizedService(makePrisma());
      const ctx = await service.assertCompatible(SOURCE_RUN, 'version-new-1');
      expect(ctx.baseFinal.id).toBe('base-final-1');
      expect(ctx.newSource.id).toBe('new-silver-1');
      expect(ctx.newDatasetVersionId).toBe('version-new-1');
      expect(ctx.baseDatasetVersionId).toBe('version-base-1');
      expect(ctx.cutTimestamp).toBe('2026-01-16T00:00:00.000Z');
    });
  });

  describe('buildCombinedArtifact', () => {
    it('creates a GOLD row and a FINAL row sharing one runId, under the base dataset', async () => {
      (pythonClient.combineForRetrain as jest.Mock).mockResolvedValue({
        object_key: 'dataset-base/artifacts/combined-1/data_gold.parquet',
        row_count: 18,
        column_count: 1,
        size_bytes: 1024,
        missing_pct: 0,
        checksum: 'combined-sha',
        column_stats_key: null,
        feature_spec_key: 'dataset-base/artifacts/combined-1/feature_spec.json',
        validation_row_count: 5,
        validation_holdout_from: '2026-01-16T00:00:00.000Z',
        validation_missing_pct: 0,
        dropped_bad_rows: 0,
        frozen_eval_checksum: 'frozen-sha',
        dedupe_dropped: 0,
        base_train_row_count: 15,
        new_train_row_count: 3,
      });

      const created: Record<string, unknown>[] = [];
      const prisma = {
        $transaction: jest
          .fn()
          .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => {
            const tx = {
              datasetArtifact: {
                create: jest
                  .fn()
                  .mockImplementation(
                    (args: { data: Record<string, unknown> }) => {
                      created.push(args.data);
                      return Promise.resolve(args.data);
                    },
                  ),
              },
            };
            return fn(tx);
          }),
      } as never;

      const service = new ModelRetrainAugmentAuthorizedService(prisma);
      const ctx = {
        baseFinal: BASE_FINAL,
        baseDatasetVersionId: 'version-base-1',
        newFinal: NEW_FINAL,
        newSource: NEW_SILVER,
        newDatasetVersionId: 'version-new-1',
        featureSpecKey: SOURCE_RUN.featureSpecKey,
        targetY: SOURCE_RUN.targetY,
        cutTimestamp: '2026-01-16T00:00:00.000Z',
      } as never;

      const result = await service.buildCombinedArtifact(ctx, USER);

      expect(created).toHaveLength(2);
      const [gold, final] = created;
      expect(gold.type).toBe('GOLD');
      expect(gold.datasetId).toBe('dataset-base');
      expect(gold.validationAlreadyScaled).toBe(true);
      expect(final.type).toBe('FINAL');
      expect(final.parentArtifactId).toBe(gold.id);
      // The exact fact findHoldoutArtifact depends on.
      expect(final.runId).toBe(gold.runId);
      expect(result.combinedFinalArtifactId).toBe(final.id);
    });
  });
});
