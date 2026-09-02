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

  it('leaves config untouched when the request carries none — Save & Deploy’s follow-up write', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    await service.updateModelService(
      'model-1',
      { deployStatus: 'running' },
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
