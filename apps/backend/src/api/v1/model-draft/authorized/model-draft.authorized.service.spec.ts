import { AppException } from '@softsensor/common';
import { PrismaTypes } from '@softsensor/prisma';
import { ModelDraftAuthorizedService } from './model-draft.authorized.service';
import { getRunManifest } from '@/lib/python-preprocess-client';

jest.mock('@/lib/python-preprocess-client', () => ({
  getRunManifest: jest.fn(),
}));

const mockGetRunManifest = getRunManifest as jest.MockedFunction<
  typeof getRunManifest
>;

/**
 * MODEL-FLOW-010-T08. Covers `listDraftsService`, the route that makes a
 * ModelDraft reachable again after the user left the wizard to go and edit a
 * dataset — no other method here changed, and the workspace-scope extraction
 * they now share is exercised through this one.
 *
 * The assertions worth having are all about the WHERE clause, because that is
 * where a list route goes wrong: silently listing another tenant's drafts is
 * invisible in a happy-path test that only counts rows.
 */

const USER: Auth.UserPayload = {
  id: 'user-1',
  role: 'MEMBER',
} as Auth.UserPayload;

const ADMIN: Auth.UserPayload = {
  id: 'admin-1',
  role: 'ADMIN',
} as Auth.UserPayload;

const DRAFT_ROW = {
  id: 'draft-1',
  name: 'Boiler efficiency',
  workspaceId: 'ws-1',
  plantId: 'plant-1',
  nodeId: 'node-1',
  datasetId: 'ds-1',
  targetY: 'TAG_A',
  algorithm: 'ridge',
  hyperparameters: { alpha: 1 },
  splitRatio: 0.8,
  status: 'ACTIVE',
  currentRunId: null,
  savedModelId: null,
  createdAt: new Date('2026-08-20T10:00:00.000Z'),
  updatedAt: new Date('2026-08-21T11:00:00.000Z'),
};

// MODEL-FLOW-007 / MODEL-SERVE-001-T03. A SUCCEEDED run with everything
// saveDraftService (and, since T03, ModelVersion creation) needs.
const RUN_ROW = {
  id: 'run-1',
  status: 'SUCCEEDED',
  datasetId: 'ds-1',
  targetY: 'TAG_A',
  algorithm: 'ridge',
  hyperparameters: { alpha: 1 },
  splitSpec: { method: 'chronological', ratio: 0.8 },
  modelKey: 'drafts/draft-1/runs/run-1/model.joblib',
  manifestKey: 'drafts/draft-1/runs/run-1/run_manifest.json',
  goldArtifactId: 'artifact-1',
  goldObjectKey: 'drafts/ds-1/artifacts/artifact-1/data.parquet',
  artifactChecksum: 'sha256:gold',
  featureSpecKey: 'drafts/ds-1/artifacts/artifact-1/feature_spec.json',
  imageDigest: 'sha256:trainer',
  metrics: { r2: 0.9, rmse: 1.2 },
};

function buildPrisma(overrides: Record<string, unknown> = {}) {
  // MODEL-FLOW-007. Shared across every $transaction call in a test unless
  // overridden — mirrors dataset-draft.authorized.service.spec.ts's own
  // `tx` convention so a test can assert on exactly what each write inside
  // the transaction received.
  const tx = {
    model: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'model-1',
            createdAt: new Date('2026-08-31T12:00:00.000Z'),
            updatedAt: new Date('2026-08-31T12:00:00.000Z'),
            nodes: null,
            ...data,
          }),
        ),
    },
    modelTrainingRun: {
      update: jest.fn().mockResolvedValue({ ...RUN_ROW, modelId: 'model-1' }),
    },
    modelDraft: {
      update: jest.fn().mockResolvedValue({
        ...DRAFT_ROW,
        status: 'SAVED',
        savedModelId: 'model-1',
      }),
    },
    // MODEL-SERVE-001-T03.
    modelVersion: {
      create: jest.fn().mockResolvedValue({
        id: 'version-1',
        modelId: 'model-1',
        version: 1,
        stage: 'STAGING',
      }),
    },
  };
  return {
    workspace: {
      findFirst: jest.fn().mockResolvedValue({ id: 'ws-1' }),
    },
    modelDraft: {
      findMany: jest.fn().mockResolvedValue([DRAFT_ROW]),
      findFirst: jest.fn().mockResolvedValue(DRAFT_ROW),
      create: jest.fn(),
      update: jest.fn(),
    },
    // MODEL-FLOW-013-T08. No candidate job by default — resolveActiveRunId
    // falls back to draft.currentRunId, DRAFT_ROW's own null.
    modelCandidateJob: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    // MODEL-FLOW-007. saveDraftService's own reads/writes — default to the
    // happy path so a test that doesn't care about Save is unaffected.
    modelTrainingRun: {
      findUnique: jest.fn().mockResolvedValue(RUN_ROW),
      update: jest.fn(),
    },
    model: {
      findFirst: jest.fn().mockResolvedValue(null), // no name collision
    },
    // MODEL-FLOW-007. Default: SAVEABLE_DRAFT/DRAFT_ROW's own nodeId
    // ('node-1') resolves within the workspace.
    nodes: {
      findFirst: jest.fn().mockResolvedValue({ id: 'node-1' }),
    },
    $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    tx,
    ...overrides,
  };
}

function makeService(prisma: ReturnType<typeof buildPrisma>) {
  return new ModelDraftAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof ModelDraftAuthorizedService
    >[0],
  );
}

describe('ModelDraftAuthorizedService — draft access and listing', () => {
  it('scopes to the caller’s own workspaces even with no filters', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    await service.listDraftsService(USER, {});

    const args = prisma.modelDraft.findMany.mock.calls[0][0];
    // The scope is applied regardless of filters — an unfiltered call must
    // not become "every draft in the database".
    expect(args.where.workspace).toEqual({
      deletedAt: null,
      OR: [{ ownerId: 'user-1' }, { members: { some: { userId: 'user-1' } } }],
    });
    expect(args.where.workspaceId).toBeUndefined();
    expect(args.where.status).toBeUndefined();
    expect(args.orderBy).toEqual({ updatedAt: 'desc' });
  });

  it('applies the workspace and status filters when given', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    await service.listDraftsService(USER, {
      workspaceId: 'ws-1',
      status: 'ACTIVE',
    });

    const args = prisma.modelDraft.findMany.mock.calls[0][0];
    expect(args.where.workspaceId).toBe('ws-1');
    expect(args.where.status).toBe('ACTIVE');
  });

  it('404s for a workspace the caller cannot reach, rather than returning []', async () => {
    // An empty list would read as "no drafts here", which is a different
    // fact from "this workspace is not yours".
    const prisma = buildPrisma({
      workspace: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const service = makeService(prisma);

    await expect(
      service.listDraftsService(USER, { workspaceId: 'ws-other' }),
    ).rejects.toBeInstanceOf(AppException);
    expect(prisma.modelDraft.findMany).not.toHaveBeenCalled();
  });

  it('drops the owner-or-member clause for an ADMIN but keeps deletedAt', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    await service.listDraftsService(ADMIN, {});

    const args = prisma.modelDraft.findMany.mock.calls[0][0];
    expect(args.where.workspace).toEqual({ deletedAt: null });
  });

  it('shares ONE access clause with the single-draft GET', async () => {
    // `workspaceScope` was extracted this pass and now backs
    // assertWorkspaceAccess, assertDraftAccess and the list — so the list
    // cannot drift wider than the routes it links to. Two clauses that merely
    // agree today would pass a per-method test and diverge later; this
    // compares them directly.
    const prisma = buildPrisma();
    const service = makeService(prisma);

    await service.listDraftsService(USER, {});
    await service.getDraftService(USER, 'draft-1');

    const listWhere = prisma.modelDraft.findMany.mock.calls[0][0].where;
    const getWhere = prisma.modelDraft.findFirst.mock.calls[0][0].where;
    expect(getWhere.workspace).toEqual(listWhere.workspace);
    expect(getWhere.id).toBe('draft-1');
  });

  it('404s a draft the access clause filters out', async () => {
    const prisma = buildPrisma({
      modelDraft: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
    });
    const service = makeService(prisma);

    await expect(
      service.getDraftService(USER, 'draft-someone-elses'),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('serialises dates as ISO strings, same shape as the single-draft GET', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    const res = await service.listDraftsService(USER, {});

    expect(res.statusCode).toBe(200);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      id: 'draft-1',
      datasetId: 'ds-1',
      targetY: 'TAG_A',
      algorithm: 'ridge',
      // A FRACTION, never a percentage — the client multiplies by 100 on the
      // way into the wizard, and this is the boundary that must not drift.
      splitRatio: 0.8,
      updatedAt: '2026-08-21T11:00:00.000Z',
    });
  });
});

describe('ModelDraftAuthorizedService — resolveActiveRunId (MODEL-FLOW-013-T08)', () => {
  it('falls back to currentRunId when the draft has no candidate job', async () => {
    const prisma = buildPrisma({
      modelDraft: {
        findMany: jest.fn(),
        findFirst: jest
          .fn()
          .mockResolvedValue({ ...DRAFT_ROW, currentRunId: 'run-legacy' }),
        create: jest.fn(),
        update: jest.fn(),
      },
    });
    const service = makeService(prisma);

    const res = await service.getDraftService(USER, 'draft-1');

    expect(res.data).toMatchObject({ resolvedRunId: 'run-legacy' });
  });

  it('prefers selectedRunId over bestRunId once the job is terminal', async () => {
    const prisma = buildPrisma({
      modelCandidateJob: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'SUCCEEDED',
          selectedRunId: 'run-user-picked',
          bestRunId: 'run-metric-winner',
        }),
      },
    });
    const service = makeService(prisma);

    const res = await service.getDraftService(USER, 'draft-1');

    expect(res.data).toMatchObject({ resolvedRunId: 'run-user-picked' });
  });

  it('falls back to bestRunId when no selection was made', async () => {
    const prisma = buildPrisma({
      modelCandidateJob: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'SUCCEEDED',
          selectedRunId: null,
          bestRunId: 'run-metric-winner',
        }),
      },
    });
    const service = makeService(prisma);

    const res = await service.getDraftService(USER, 'draft-1');

    expect(res.data).toMatchObject({ resolvedRunId: 'run-metric-winner' });
  });

  it('ignores a non-terminal job and falls back to currentRunId — a mid-sweep job has no coherent answer yet', async () => {
    const prisma = buildPrisma({
      modelDraft: {
        findMany: jest.fn(),
        findFirst: jest
          .fn()
          .mockResolvedValue({ ...DRAFT_ROW, currentRunId: 'run-in-flight' }),
        create: jest.fn(),
        update: jest.fn(),
      },
      modelCandidateJob: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'RUNNING',
          selectedRunId: null,
          bestRunId: 'run-partial-best',
        }),
      },
    });
    const service = makeService(prisma);

    const res = await service.getDraftService(USER, 'draft-1');

    expect(res.data).toMatchObject({ resolvedRunId: 'run-in-flight' });
  });

  it('never writes ModelDraft.currentRunId — this is a read-only resolver', async () => {
    const prisma = buildPrisma({
      modelCandidateJob: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'SUCCEEDED',
          selectedRunId: 'run-user-picked',
          bestRunId: 'run-metric-winner',
        }),
      },
    });
    const service = makeService(prisma);

    await service.getDraftService(USER, 'draft-1');

    expect(prisma.modelDraft.update).not.toHaveBeenCalled();
  });
});

describe('ModelDraftAuthorizedService — patchDraftService write refusal (MODEL-FLOW-011)', () => {
  it('409s once the draft is SAVED', async () => {
    const prisma = buildPrisma({
      modelDraft: {
        findMany: jest.fn(),
        findFirst: jest
          .fn()
          .mockResolvedValue({ ...DRAFT_ROW, status: 'SAVED' }),
        create: jest.fn(),
        update: jest.fn(),
      },
    });
    const service = makeService(prisma);

    await expect(
      service.patchDraftService(USER, 'draft-1', {}),
    ).rejects.toBeInstanceOf(AppException);
    expect(prisma.modelDraft.update).not.toHaveBeenCalled();
  });

  it('409s once the draft is ABANDONED — the sweep, or the Remove button, must be learnable at the next edit', async () => {
    const prisma = buildPrisma({
      modelDraft: {
        findMany: jest.fn(),
        findFirst: jest
          .fn()
          .mockResolvedValue({ ...DRAFT_ROW, status: 'ABANDONED' }),
        create: jest.fn(),
        update: jest.fn(),
      },
    });
    const service = makeService(prisma);

    await expect(
      service.patchDraftService(USER, 'draft-1', {}),
    ).rejects.toBeInstanceOf(AppException);
    expect(prisma.modelDraft.update).not.toHaveBeenCalled();
  });

  it('still accepts a PATCH on an ACTIVE draft', async () => {
    const prisma = buildPrisma({
      modelDraft: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(DRAFT_ROW),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ ...DRAFT_ROW, name: 'Renamed' }),
      },
    });
    const service = makeService(prisma);

    await service.patchDraftService(USER, 'draft-1', { name: 'Renamed' });

    expect(prisma.modelDraft.update).toHaveBeenCalled();
  });
});

describe('ModelDraftAuthorizedService — saveDraftService (MODEL-FLOW-007)', () => {
  const SAVEABLE_DRAFT = { ...DRAFT_ROW, currentRunId: 'run-1' };

  beforeEach(() => {
    mockGetRunManifest.mockReset();
    mockGetRunManifest.mockResolvedValue({ framework_versions: null });
  });

  function draftPrisma(overrides: Record<string, unknown> = {}) {
    return buildPrisma({
      modelDraft: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(SAVEABLE_DRAFT),
        create: jest.fn(),
        update: jest.fn(),
      },
      ...overrides,
    });
  }

  it('409s once the draft is already SAVED — before touching the run at all', async () => {
    const prisma = draftPrisma({
      modelDraft: {
        findMany: jest.fn(),
        findFirst: jest
          .fn()
          .mockResolvedValue({ ...SAVEABLE_DRAFT, status: 'SAVED' }),
        create: jest.fn(),
        update: jest.fn(),
      },
    });
    const service = makeService(prisma);

    await expect(
      service.saveDraftService(USER, 'draft-1', { name: 'My Model' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.modelTrainingRun.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('422s when the draft has no run at all', async () => {
    const prisma = draftPrisma({
      modelDraft: {
        findMany: jest.fn(),
        findFirst: jest
          .fn()
          .mockResolvedValue({ ...DRAFT_ROW, currentRunId: null }),
        create: jest.fn(),
        update: jest.fn(),
      },
      modelCandidateJob: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const service = makeService(prisma);

    await expect(
      service.saveDraftService(USER, 'draft-1', { name: 'My Model' }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('422s when the resolved run has not SUCCEEDED', async () => {
    const prisma = draftPrisma({
      modelTrainingRun: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...RUN_ROW, status: 'RUNNING' }),
        update: jest.fn(),
      },
    });
    const service = makeService(prisma);

    await expect(
      service.saveDraftService(USER, 'draft-1', { name: 'My Model' }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('422s when the SUCCEEDED run has no modelKey — cannot save what was never uploaded', async () => {
    const prisma = draftPrisma({
      modelTrainingRun: {
        findUnique: jest.fn().mockResolvedValue({ ...RUN_ROW, modelKey: null }),
        update: jest.fn(),
      },
    });
    const service = makeService(prisma);

    await expect(
      service.saveDraftService(USER, 'draft-1', { name: 'My Model' }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('400s on a name already used in the workspace — mirrors createModelService’s own pre-check', async () => {
    const prisma = draftPrisma({
      model: {
        findFirst: jest.fn().mockResolvedValue({ id: 'model-existing' }),
      },
    });
    const service = makeService(prisma);

    await expect(
      service.saveDraftService(USER, 'draft-1', { name: 'Boiler efficiency' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('404s a nodeId that does not belong to the draft’s own workspace — mirrors createModelService’s own check, closes a cross-tenant leak', async () => {
    const prisma = draftPrisma({
      nodes: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const service = makeService(prisma);

    await expect(
      service.saveDraftService(USER, 'draft-1', {
        name: 'My Model',
        nodeId: 'node-from-another-workspace',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('also validates the fallback draft.nodeId, not just an explicit request nodeId', async () => {
    const prisma = draftPrisma({
      nodes: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const service = makeService(prisma);

    // No nodeId in the request — falls back to SAVEABLE_DRAFT.nodeId
    // ('node-1'), which PatchModelDraftSchema never uuid-validated.
    await expect(
      service.saveDraftService(USER, 'draft-1', { name: 'My Model' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('writes all four rows inside one $transaction, converts the split fraction to a percentage, and derives config from the run — not the request body', async () => {
    const prisma = draftPrisma();
    const service = makeService(prisma);

    const res = await service.saveDraftService(USER, 'draft-1', {
      name: 'My Model',
      description: 'from the wizard',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const createArgs = prisma.tx.model.create.mock.calls[0][0];
    expect(createArgs.data.workspaceId).toBe('ws-1');
    expect(createArgs.data.name).toBe('My Model');
    expect(createArgs.data.datasetId).toBe(RUN_ROW.datasetId);
    expect(createArgs.data.data.config).toMatchObject({
      description: 'from the wizard',
      datasetId: RUN_ROW.datasetId,
      algorithm: RUN_ROW.algorithm,
      algorithms: [RUN_ROW.algorithm],
      targetVariables: [RUN_ROW.targetY],
      hyperparameters: RUN_ROW.hyperparameters,
      // 0.8 (fraction, splitSpec.ratio) -> 80 (percentage) — the exact unit
      // fix ModelConfigSchema's own comment names as this feature's job.
      trainTestSplit: 80,
    });

    expect(prisma.tx.modelTrainingRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { modelId: 'model-1' },
    });
    expect(prisma.tx.modelDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { status: 'SAVED', savedModelId: 'model-1' },
    });

    // MODEL-SERVE-001-T03. Version 1, STAGING (never set explicitly — the
    // schema default), one hop off the adopted run's own pinned columns.
    const versionArgs = prisma.tx.modelVersion.create.mock.calls[0][0];
    expect(versionArgs.data).toMatchObject({
      modelId: 'model-1',
      version: 1,
      sourceRunId: 'run-1',
      sourceDatasetId: RUN_ROW.datasetId,
      goldArtifactId: RUN_ROW.goldArtifactId,
      goldObjectKey: RUN_ROW.goldObjectKey,
      artifactChecksum: RUN_ROW.artifactChecksum,
      featureSpecKey: RUN_ROW.featureSpecKey,
      modelObjectKey: RUN_ROW.modelKey,
      algorithm: RUN_ROW.algorithm,
      hyperparameters: RUN_ROW.hyperparameters,
      imageDigest: RUN_ROW.imageDigest,
      metrics: RUN_ROW.metrics,
    });
    expect(versionArgs.data.stage).toBeUndefined();

    expect(res.statusCode).toBe(201);
    expect(res.data.id).toBe('model-1');
  });

  it('saves successfully with framework_versions null when the manifest read fails — a legacy/missing manifest must not block Save', async () => {
    mockGetRunManifest.mockRejectedValue(new Error('NoSuchKey'));
    const prisma = draftPrisma();
    const service = makeService(prisma);

    await service.saveDraftService(USER, 'draft-1', { name: 'My Model' });

    const createArgs = prisma.tx.model.create.mock.calls[0][0];
    expect(createArgs.data.data.config.frameworkVersions).toBeNull();
  });

  it('records framework_versions inside config when the manifest has them', async () => {
    mockGetRunManifest.mockResolvedValue({
      framework_versions: { sklearn: '1.5.1' },
    });
    const prisma = draftPrisma();
    const service = makeService(prisma);

    await service.saveDraftService(USER, 'draft-1', { name: 'My Model' });

    const createArgs = prisma.tx.model.create.mock.calls[0][0];
    expect(createArgs.data.data.config.frameworkVersions).toEqual({
      sklearn: '1.5.1',
    });
  });

  it('never reads the manifest when the run has no manifestKey', async () => {
    const prisma = draftPrisma({
      modelTrainingRun: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...RUN_ROW, manifestKey: null }),
        update: jest.fn(),
      },
    });
    const service = makeService(prisma);

    await service.saveDraftService(USER, 'draft-1', { name: 'My Model' });

    expect(mockGetRunManifest).not.toHaveBeenCalled();
  });

  it('maps a P2002 unique-name race to a 409, not a raw Prisma error', async () => {
    const err = new Error(
      'Unique constraint failed on the fields: (`workspaceId`,`name`)',
    );
    Object.setPrototypeOf(
      err,
      PrismaTypes.PrismaClientKnownRequestError.prototype,
    );
    (err as unknown as { code: string }).code = 'P2002';

    const prisma = draftPrisma({
      $transaction: jest.fn().mockRejectedValue(err),
    });
    const service = makeService(prisma);

    await expect(
      service.saveDraftService(USER, 'draft-1', { name: 'My Model' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('propagates any other transaction failure without pretending the save succeeded', async () => {
    const prisma = draftPrisma({
      $transaction: jest.fn().mockRejectedValue(new Error('connection lost')),
    });
    const service = makeService(prisma);

    await expect(
      service.saveDraftService(USER, 'draft-1', { name: 'My Model' }),
    ).rejects.toThrow('connection lost');
  });

  // MODEL-FLOW-016-T12. Adoption itself is unchanged for a CV run — one run,
  // one model.joblib — but the saved config has to SAY it was a CV run, or a
  // fold mean reads as the shipped model's own held-out score.
  describe('a Cross-Validation run', () => {
    // The real shape a CV run's own /complete call writes, from
    // CvExpandingSplitSpecSchema — k cut points, no `ratio`.
    const CV_RUN = {
      ...RUN_ROW,
      splitSpec: {
        method: 'cv_expanding',
        n_splits: 3,
        source_rows: 8350,
        labelled_rows: 8350,
        distinct_labelled_values: 32,
        folds: [
          {
            cut_timestamp: '2026-02-05T14:15:00.000Z',
            train_rows: 2089,
            test_rows: 2087,
          },
          {
            cut_timestamp: '2026-02-19T12:05:00.000Z',
            train_rows: 4176,
            test_rows: 2087,
          },
          {
            cut_timestamp: '2026-03-05T09:55:00.000Z',
            train_rows: 6263,
            test_rows: 2087,
          },
        ],
      },
      // A CV run's metrics is the FOLD aggregate — no plain r2 at all.
      metrics: { cv_r2_mean: 0.41, cv_r2_std: 0.12, refit_rows: 8350 },
      holdoutMetrics: null,
    };

    function cvPrisma(run: Record<string, unknown> = CV_RUN) {
      return draftPrisma({
        modelTrainingRun: {
          findUnique: jest.fn().mockResolvedValue(run),
          update: jest.fn(),
        },
      });
    }

    /** The config the transaction actually wrote. Typed rather than read
     *  straight off `mock.calls` (which is `any`) so these assertions cannot
     *  silently pass on a key that stopped existing. */
    function savedConfig(prisma: ReturnType<typeof buildPrisma>) {
      const calls = prisma.tx.model.create.mock.calls as unknown as Array<
        [{ data: { data: { config: Record<string, unknown> } } }]
      >;
      return calls[0][0].data.data.config;
    }

    function savedVersion(prisma: ReturnType<typeof buildPrisma>) {
      const calls = prisma.tx.modelVersion.create.mock
        .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
      return calls[0][0].data;
    }

    it('records k and the unscored holdout, and writes NO trainTestSplit', async () => {
      const prisma = cvPrisma();
      const service = makeService(prisma);

      await service.saveDraftService(USER, 'draft-1', { name: 'My Model' });

      const config = savedConfig(prisma);
      expect(config.crossValidation).toEqual({
        method: 'cv_expanding',
        nSplits: 3,
        holdoutScored: false,
      });
      // Asserted explicitly, not left implied: today this holds only because
      // a cv_expanding splitSpec carries no `ratio` for extractSplitRatio to
      // find. A future variant that did carry one would silently print a
      // train/test split for a run that never had a single cut.
      expect(config.trainTestSplit).toBeUndefined();
    });

    it('records holdoutScored once the separate scoring phase has produced a number', async () => {
      const prisma = cvPrisma({
        ...CV_RUN,
        holdoutMetrics: { r2: -4.536, mae: 0.181, rmse: 0.21 },
      });
      const service = makeService(prisma);

      await service.saveDraftService(USER, 'draft-1', { name: 'My Model' });

      const config = savedConfig(prisma);
      expect(config.crossValidation).toMatchObject({ holdoutScored: true });
      // Pointer, not copy: the numbers stay on the run row ModelVersion
      // already references through sourceRunId.
      expect(config.crossValidation).not.toHaveProperty('holdoutMetrics');
    });

    it('adopts by pointer exactly as a chronological run does — the refit is the run’s one model.joblib', async () => {
      const prisma = cvPrisma();
      const service = makeService(prisma);

      await service.saveDraftService(USER, 'draft-1', { name: 'My Model' });

      const version = savedVersion(prisma);
      expect(version.modelObjectKey).toBe(CV_RUN.modelKey);
      expect(version.sourceRunId).toBe('run-1');
      // The known consequence, pinned so it cannot change silently: a CV
      // run's metrics snapshot has no plain r2, so MODEL-SERVE-001-T06's
      // promote floor (extractR2) reads null and requires a written-reason
      // override. Recorded in this feature's findings; MODEL-SERVE owns the
      // fix, since merging a holdout r2 into that key would make it mean a
      // different quantity for CV rows than for every other row.
      expect(version.metrics).toEqual(CV_RUN.metrics);
      expect(version.metrics).not.toHaveProperty('r2');
    });

    it('leaves a chronological run’s config with no crossValidation at all', async () => {
      const prisma = draftPrisma();
      const service = makeService(prisma);

      await service.saveDraftService(USER, 'draft-1', { name: 'My Model' });

      const config = savedConfig(prisma);
      expect(config.crossValidation).toBeNull();
      expect(config.trainTestSplit).toBe(80);
    });
  });
});
