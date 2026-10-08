import { ModelAuthorizedService } from './model.authorized.service';

/**
 * MODEL-FLOW-016-T12. `updateModelService`'s config merge, and nothing else.
 *
 * This file exists because T12's own instruction was to verify the merge "by
 * reading it, not by assuming" — and the read found a live bug: the merge
 * replaced `config` WHOLESALE, while edit mode ("Save Changes") sends a
 * config rebuilt from wizard atoms by `buildModelConfig`, which has no field
 * for either server-derived key. So renaming a saved model silently dropped
 * `frameworkVersions` (MODEL-FLOW-007-T11's provenance) from the row.
 *
 * MODEL-FLOW-007-T11 guarded the SIBLING-key case through `normalizeData`'s
 * top-level whitelist; this is the second path, which that guard never saw.
 */

const USER_ID = 'user-1';
const ROLE = 'ADMIN';

const SAVED_CONFIG = {
  datasetId: 'ds-1',
  algorithm: 'ridge',
  targetVariables: ['TAG_A'],
  hyperparameters: { alpha: 1 },
  description: 'original',
  // Both keys the client cannot author — derived at Save Model from the
  // adopted training run.
  frameworkVersions: { sklearn: '1.5.1' },
  crossValidation: {
    method: 'cv_expanding',
    nSplits: 3,
    holdoutScored: true,
  },
};

const MODEL_ROW = {
  id: 'model-1',
  workspaceId: 'ws-1',
  name: 'Boiler efficiency',
  data: {
    deployStatus: 'stopped',
    prodStatus: 'normal',
    editHistory: [],
    logs: [],
    config: SAVED_CONFIG,
  },
};

/** What edit mode actually sends: `buildModelConfig`'s output, which declares
 *  no field for either server-derived key. */
const CLIENT_CONFIG = {
  datasetId: 'ds-1',
  algorithm: 'ridge',
  targetVariables: ['TAG_A'],
  hyperparameters: { alpha: 1 },
  description: 'original',
};

function buildPrisma(model: Record<string, unknown> = MODEL_ROW) {
  return {
    model: {
      findUnique: jest.fn().mockResolvedValue(model),
      findFirst: jest.fn().mockResolvedValue(null), // no name collision
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...model, ...data, nodes: null }),
        ),
    },
    workspace: { findFirst: jest.fn().mockResolvedValue({ id: 'ws-1' }) },
    workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ firstName: 'Ada', lastName: 'Lovelace' }),
    },
    // MODEL-SERVE-006-T12. updateModelService/appendLogService now derive
    // deployStatus on every return (lib/deploy-status.ts) — no schedule
    // means every model in this fixture derives 'stopped', which is what
    // the pre-existing `data.deployStatus: 'stopped'` fixture value already
    // implied.
    inferenceSchedule: { findMany: jest.fn().mockResolvedValue([]) },
    inferenceWindow: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeService(prisma: ReturnType<typeof buildPrisma>) {
  return new ModelAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof ModelAuthorizedService
    >[0],
  );
}

function writtenConfig(prisma: ReturnType<typeof buildPrisma>) {
  const calls = prisma.model.update.mock.calls as unknown as Array<
    [{ data: { data: { config?: Record<string, unknown> } } }]
  >;
  return calls[0][0].data.data.config;
}

describe('ModelAuthorizedService — updateModelService config merge', () => {
  it('preserves frameworkVersions and crossValidation when the client omits them', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    await service.updateModelService(
      'model-1',
      { name: 'Renamed', config: CLIENT_CONFIG },
      USER_ID,
      ROLE,
    );

    expect(writtenConfig(prisma)).toEqual({
      ...CLIENT_CONFIG,
      frameworkVersions: SAVED_CONFIG.frameworkVersions,
      crossValidation: SAVED_CONFIG.crossValidation,
    });
  });

  it('does NOT resurrect an ordinary key the user cleared — this is a named list, not a blanket merge', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    // Clearing the description makes buildModelConfig omit it entirely. A
    // `{...current, ...incoming}` merge would bring the old value back.
    const withoutDescription = { ...CLIENT_CONFIG };
    delete (withoutDescription as { description?: string }).description;
    await service.updateModelService(
      'model-1',
      { config: withoutDescription },
      USER_ID,
      ROLE,
    );

    expect(writtenConfig(prisma)).not.toHaveProperty('description');
  });

  it('lets an incoming config that DOES carry a server-derived key win', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    await service.updateModelService(
      'model-1',
      {
        config: {
          ...CLIENT_CONFIG,
          crossValidation: null,
          frameworkVersions: { sklearn: '1.6.0' },
        },
      },
      USER_ID,
      ROLE,
    );

    const config = writtenConfig(prisma);
    expect(config?.crossValidation).toBeNull();
    expect(config?.frameworkVersions).toEqual({ sklearn: '1.6.0' });
  });

  it('leaves config untouched when the request carries no config at all', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    // MODEL-SERVE-006-T12 removed `deployStatus` from this DTO (derived,
    // never caller-set) and MODEL-SERVE-012-T09 removed `prodStatus` for the
    // same reason, each time retargeting this call. `statusDetail` is the
    // remaining config-free field and stands in here, preserving this test's
    // actual point: a request that omits `config` must not touch it. Like
    // the fields before it, it lands in `editedLabels`, so the edit-history
    // branch this case also exercises is unchanged.
    await service.updateModelService(
      'model-1',
      { statusDetail: null },
      USER_ID,
      ROLE,
    );

    expect(writtenConfig(prisma)).toEqual(SAVED_CONFIG);
  });

  it('does not invent a config for a legacy row that never had one', async () => {
    const prisma = buildPrisma({
      ...MODEL_ROW,
      data: {
        deployStatus: 'stopped',
        prodStatus: 'normal',
        editHistory: [],
        logs: [],
      },
    });
    const service = makeService(prisma);

    await service.updateModelService(
      'model-1',
      { config: CLIENT_CONFIG },
      USER_ID,
      ROLE,
    );

    expect(writtenConfig(prisma)).toEqual(CLIENT_CONFIG);
  });
});

/**
 * MODEL-SERVE-001-T30/V22. THE COMPOSITION, which nothing else asserted.
 *
 * Every client test for the Alerts page hand-builds `data.monitoring` on its
 * fixture, and `deploy-status.spec.ts` proves `deriveDeployStatuses` RETURNS
 * a monitoring verdict — but neither proves the LIST ENDPOINT actually
 * overlays it onto what the client receives. `useAllModels` fetches
 * `GET /api/v1/authorized/model?workspaceId=...`, which lands here.
 *
 * If this route ever stops calling `overlayDeployStatus`, `data.monitoring`
 * is `undefined` on every model, `hasMonitoringAlert` is false for all of
 * them, and the Alerts page goes exactly as silent as it was before T30 —
 * with every one of those client cases still green. That is the same shape
 * of defect as the two false premises T30's own note had to correct: a
 * payload claim that read true by inspection and was false in code.
 */
describe('ModelAuthorizedService.getModelsService — the list payload contract (MODEL-SERVE-001-T30/V22)', () => {
  it('overlays BOTH axes onto every returned model', async () => {
    const prisma = buildPrisma();
    prisma.model.findMany = jest.fn().mockResolvedValue([MODEL_ROW]);
    const service = makeService(prisma);

    const res = await service.getModelsService('ws-1', USER_ID, ROLE);
    const first = res.data[0] as { data: Record<string, unknown> };

    // The deploy axis, as before.
    expect(first.data.deployStatus).toBe('stopped');
    // The MONITORING axis — the field this whole task depends on reaching
    // the client. Present-and-shaped, never absent.
    expect(first.data.monitoring).toEqual({
      status: 'OFF',
      reason: null,
      frozenColumns: [],
    });
  });
});
