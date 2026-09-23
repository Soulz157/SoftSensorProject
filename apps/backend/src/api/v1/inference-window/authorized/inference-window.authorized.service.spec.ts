import { InferenceWindowAuthorizedService } from './inference-window.authorized.service';
import {
  inferenceWindowTruthSeries,
  presignInferenceWindowObject,
} from '@/lib/python-preprocess-client';
import { env } from '@/config/env.config';

jest.mock('@/lib/python-preprocess-client');

afterEach(() => {
  jest.clearAllMocks();
});

const user = { id: 'user-1', role: 'ADMIN' } as unknown as Auth.UserPayload;

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    model: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'model-1', workspaceId: 'ws-1', data: {} }),
      update: jest.fn().mockResolvedValue({}),
    },
    // MODEL-SERVE-006-T12. putScheduleService's stampDeployed reads the
    // acting user's name on the OFF -> ON transition.
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ firstName: 'Ada', lastName: 'Lovelace' }),
    },
    workspace: { findFirst: jest.fn().mockResolvedValue({ id: 'ws-1' }) },
    workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
    modelVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      findFirstOrThrow: jest.fn(),
    },
    dataset: { findUnique: jest.fn().mockResolvedValue(null) },
    // MODEL-SERVE-013-T01. getScheduleService resolves the schedule's
    // sourceId and the dataset's candidates to NAMES. Empty by default so
    // every pre-existing case here, none of which is about the data-source
    // surface, keeps asserting what it was written for.
    dataSource: { findMany: jest.fn().mockResolvedValue([]) },
    inferenceSchedule: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      // MODEL-SERVE-001-T25: the refusal path's evidence write.
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    inferenceWindow: {
      findUniqueOrThrow: jest.fn(),
      // MODEL-SERVE-011-T02: runNowService's own insert (skipDuplicates).
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      // MODEL-SERVE-001-T20: the disable branch's own write.
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      // Present so buildPrisma's OWN return type (inferred once, from this
      // static shape — TS does not re-infer per call-site override) carries
      // these keys too; `statusPrisma` below replaces this whole nested
      // object with its own richer mock at runtime regardless.
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    // Array form only — putScheduleService's disable branch is the one
    // caller in this file, and it passes `[updateMany, updateMany]`, not a
    // callback. Same shape model-run.authorized.service.spec.ts already
    // uses for its own array-form $transaction calls.
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    ...overrides,
  };
}

function buildDescriptor(overrides: Record<string, unknown> = {}) {
  return {
    getDescriptorByVersionIdService: jest.fn().mockResolvedValue({
      data: {
        derivedFromTarget: [],
        targetScaled: false,
        featureColumns: ['a', 'b'],
        modelId: 'model-1',
        versionId: 'version-1',
        modelUrl: 'https://example/model.joblib',
        modelChecksum: 'checksum',
        scalers: {},
        scalingParams: {},
      },
    }),
    ...overrides,
  };
}

/** MODEL-SERVE-005-T03. The truth sweeper is injected only for the
 *  re-join route; every case in this file exercises schedule/window paths
 *  that never reach it, so a bare stub is the honest double. */
function buildTruthSweeper(overrides = {}) {
  return { joinWindow: jest.fn().mockResolvedValue(undefined), ...overrides };
}

/** MODEL-SERVE-001-T21. `getStatusService` is the only caller — a bare
 *  OFF/null stub by default so every pre-existing test in this file, none
 *  of which cares about the health axis, needs no change. */
function buildMonitoring(overrides = {}) {
  return {
    getHealthStatus: jest
      .fn()
      .mockResolvedValue({ status: 'OFF', thresholds: null }),
    ...overrides,
  };
}

/** MODEL-SERVE-001-T25. `putScheduleService` is the only caller. Defaults to
 *  a PASSING probe so every pre-existing enable test in this file — none of
 *  which is about preflight — keeps asserting the refusal it was written for
 *  rather than tripping over a new one. V18's own cases override it. */
function buildInputStatus(overrides = {}) {
  return {
    preflightSourceService: jest
      .fn()
      .mockResolvedValue({ ok: true, reason: null }),
    ...overrides,
  };
}

/** MODEL-SERVE-011-T02. `runNowService` is the only caller. `dispatchOne` is
 *  fire-and-forget there, so it resolves by default — a test asserting the
 *  dispatch happened reads the mock's calls, and no other test in this file
 *  reaches it. */
function buildScheduler(overrides = {}) {
  return {
    dispatchOne: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** MODEL-SERVE-011-T08. `runNowService` awaits ONE live score. Defaults to a
 *  successful point so the window-plane cases stay about the window. */
function buildLivePredict(overrides = {}) {
  return {
    scoreOne: jest.fn().mockResolvedValue({
      ok: true,
      predicted: 42.5,
      at: '2026-09-17T04:59:00.000Z',
    }),
    ...overrides,
  };
}

function makeService(
  prisma: ReturnType<typeof buildPrisma>,
  descriptor: ReturnType<typeof buildDescriptor> = buildDescriptor(),
  truthSweeper: ReturnType<typeof buildTruthSweeper> = buildTruthSweeper(),
  monitoring: ReturnType<typeof buildMonitoring> = buildMonitoring(),
  inputStatus: ReturnType<typeof buildInputStatus> = buildInputStatus(),
  scheduler: ReturnType<typeof buildScheduler> = buildScheduler(),
  livePredict: ReturnType<typeof buildLivePredict> = buildLivePredict(),
) {
  return new InferenceWindowAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof InferenceWindowAuthorizedService
    >[0],
    descriptor as unknown as ConstructorParameters<
      typeof InferenceWindowAuthorizedService
    >[1],
    truthSweeper as unknown as ConstructorParameters<
      typeof InferenceWindowAuthorizedService
    >[2],
    monitoring as unknown as ConstructorParameters<
      typeof InferenceWindowAuthorizedService
    >[3],
    inputStatus as unknown as ConstructorParameters<
      typeof InferenceWindowAuthorizedService
    >[4],
    scheduler as unknown as ConstructorParameters<
      typeof InferenceWindowAuthorizedService
    >[5],
    livePredict as unknown as ConstructorParameters<
      typeof InferenceWindowAuthorizedService
    >[6],
  );
}

describe('InferenceWindowAuthorizedService.putScheduleService — D5 enable-time refusals (MODEL-SERVE-006-T09)', () => {
  it('refuses when the model has no PRODUCTION version', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);
    await expect(
      service.putScheduleService('model-1', { enabled: true }, user),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses when the model derives a feature from the target', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
    });
    const descriptor = buildDescriptor({
      getDescriptorByVersionIdService: jest.fn().mockResolvedValue({
        data: {
          derivedFromTarget: ['S204FBP.lab'],
          targetScaled: false,
          featureColumns: ['a', 'b'],
        },
      }),
    });
    const service = makeService(prisma, descriptor);
    await expect(
      service.putScheduleService('model-1', { enabled: true }, user),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses when the target is scaled with no recorded inverse transform', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
    });
    const descriptor = buildDescriptor({
      getDescriptorByVersionIdService: jest.fn().mockResolvedValue({
        data: {
          derivedFromTarget: [],
          targetScaled: true,
          featureColumns: ['a'],
        },
      }),
    });
    const service = makeService(prisma, descriptor);
    await expect(
      service.putScheduleService('model-1', { enabled: true }, user),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses when no feature_columns are recorded', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
    });
    const descriptor = buildDescriptor({
      getDescriptorByVersionIdService: jest.fn().mockResolvedValue({
        data: {
          derivedFromTarget: [],
          targetScaled: false,
          featureColumns: [],
        },
      }),
    });
    const service = makeService(prisma, descriptor);
    await expect(
      service.putScheduleService('model-1', { enabled: true }, user),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('requires an explicit sourceId when the dataset has more than one source (D8)', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a', 'src-b'],
          pipelineConfig: { sourceFetchConfigs: {}, baseTags: [] },
        }),
      },
    });
    const service = makeService(prisma);
    await expect(
      service.putScheduleService('model-1', { enabled: true }, user),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('enables successfully when every guard passes, snapshotting fetchConfig', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: ['tag1'],
          },
        }),
      },
    });
    const service = makeService(prisma);
    const result = await service.putScheduleService(
      'model-1',
      { enabled: true },
      user,
    );
    expect(result.statusCode).toBe(200);
    expect(prisma.inferenceSchedule.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.inferenceSchedule.upsert.mock.calls[0][0];
    expect(call.create.sourceId).toBe('src-a');
    expect(call.create.fetchConfig).toEqual({
      intervalTime: '1m',
      baseTags: ['tag1'],
    });
    // MODEL-SERVE-001-T14. A 1-minute interval at the default 60-minute
    // cadence reproduces env.INFERENCE_MIN_ROWS's OWN derivation exactly
    // (30) — the case this task must not disturb.
    expect(call.create.minRows).toBe(30);
    expect(result.data?.minRows).toBe(30);
  });

  // ── MODEL-SERVE-001-T25 / V18 ────────────────────────────────────────────

  /**
   * V18. PROVE PREFLIGHT REFUSES AN UNREACHABLE SOURCE AND PASSES A REACHABLE
   * ONE.
   *
   * ONE ASSERTION HERE IS DELIBERATELY NOT THE ONE V18 ASKED FOR, AND THIS IS
   * WHY. V18's text says to assert that ZERO InferenceWindow rows were
   * inserted on the refusal path. Verified against the code rather than
   * against T25's prose: `putScheduleService` INSERTS NO WINDOWS AT ALL, on
   * any path — it ends in a single `inferenceSchedule.upsert`, and the 48h
   * backfill is minted later by the scheduler tick's `insertDueWindows`
   * (inference-window-scheduler.service.ts). So "no windows were inserted"
   * passes identically whether or not the refusal works, which is exactly the
   * kind of cannot-fail assertion T11 and T12 each had to throw out.
   *
   * What V18 actually cares about — that no dormant schedule is left behind
   * for the tick to find — is asserted instead: the `upsert` never runs, so
   * no row is left `enabled: true`, and the tick has nothing to enumerate.
   */
  it('refuses to enable when the live preflight probe fails, with the connector’s own text', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: ['tag1'],
          },
        }),
      },
    });
    const connectorText =
      'Could not read live tag status: PI Web API error: ' +
      'getaddrinfo ENOTFOUND pi.example.internal';
    const inputStatus = buildInputStatus({
      preflightSourceService: jest
        .fn()
        .mockResolvedValue({ ok: false, reason: connectorText }),
    });
    const service = makeService(
      prisma,
      buildDescriptor(),
      buildTruthSweeper(),
      buildMonitoring(),
      inputStatus,
    );

    await expect(
      service.putScheduleService('model-1', { enabled: true }, user),
    ).rejects.toMatchObject({
      statusCode: 422,
      // VERBATIM, not a category. V09 exists because a guessed category sent
      // a reader to audit a config that was already correct.
      message: expect.stringContaining(connectorText),
    });

    // The schedule is never written, so nothing is left enabled for the
    // scheduler tick to pick up and fail on hourly forever.
    expect(prisma.inferenceSchedule.upsert).not.toHaveBeenCalled();
  });

  it('probes the source the caller actually chose, not the one already on the row', async () => {
    // Probing one source and enabling another is the silently-wrong-but-
    // still-returns-an-answer class this whole feature exists to close.
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a', 'src-b'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-b': { intervalTime: '1m' } },
            baseTags: [],
          },
        }),
      },
    });
    const inputStatus = buildInputStatus();
    const service = makeService(
      prisma,
      buildDescriptor(),
      buildTruthSweeper(),
      buildMonitoring(),
      inputStatus,
    );

    await service.putScheduleService(
      'model-1',
      { enabled: true, sourceId: 'src-b' },
      user,
    );

    expect(inputStatus.preflightSourceService).toHaveBeenCalledWith(
      'model-1',
      user,
      'src-b',
    );
  });

  it('records passing preflight evidence on the row it enables', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: [],
          },
        }),
      },
    });
    const service = makeService(prisma);

    await service.putScheduleService('model-1', { enabled: true }, user);

    const call = prisma.inferenceSchedule.upsert.mock.calls[0][0];
    expect(call.create.preflightOk).toBe(true);
    expect(call.create.preflightReason).toBeNull();
    expect(call.create.preflightAt).toBeInstanceOf(Date);
    expect(call.update.preflightOk).toBe(true);
  });

  it('does NOT probe a settings-only update on an already-running schedule', async () => {
    // THE REGRESSION THIS PINS: putScheduleService also serves partial
    // settings updates (that is what T09's merge logic exists for). If the
    // probe ran here, a thirty-second PI blip while an operator nudged a
    // threshold would refuse the update AND write preflightOk:false to a row
    // that stays enabled and whose windows keep succeeding — pinning a
    // demonstrably working model to Failed. Refusing the press that STARTS a
    // schedule is T25's scope; condemning one already RUNNING is the
    // auto-pause T19 decided against.
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: [],
          },
        }),
      },
      inferenceSchedule: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        // ALREADY RUNNING — this is the OFF -> ON discriminator.
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          autoRetrain: false,
          warnSd: 1.5,
          criticalSd: 3.0,
          driftMonitor: false,
          truthLagMinutes: 1440,
          truthToleranceMinutes: 30,
          truthHorizonHours: 168,
        }),
      },
    });
    const inputStatus = buildInputStatus({
      // Would refuse if it were consulted at all.
      preflightSourceService: jest
        .fn()
        .mockResolvedValue({ ok: false, reason: 'PI blipped' }),
    });
    const service = makeService(
      prisma,
      buildDescriptor(),
      buildTruthSweeper(),
      buildMonitoring(),
      inputStatus,
    );

    const result = await service.putScheduleService(
      'model-1',
      { enabled: true, warnSd: 2.5 },
      user,
    );

    expect(result.statusCode).toBe(200);
    expect(inputStatus.preflightSourceService).not.toHaveBeenCalled();
    // The row's existing observation is left alone, not overwritten with a
    // probe that never ran, and not nulled back to "not probed".
    const call = prisma.inferenceSchedule.upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('preflightOk');
    expect(call.update).not.toHaveProperty('preflightAt');
    expect(prisma.inferenceSchedule.update).not.toHaveBeenCalled();
  });

  it('enables a SQL-sourced schedule with preflightOk NULL — not probed is not a pass, and not a refusal', async () => {
    // input-status accepts PI only, and sql_connect.py binds the time range
    // as VARCHAR, so a SQL probe would fail for a CONNECTOR defect rather
    // than for the operator's config. Refusing a whole source class on that
    // basis would be manufacturing false refusals.
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-sql'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-sql': {} },
            baseTags: [],
          },
        }),
      },
    });
    const notProbed =
      'Not probed: live source checks are available for PI sources only ' +
      '(this source is "postgres").';
    const inputStatus = buildInputStatus({
      preflightSourceService: jest
        .fn()
        .mockResolvedValue({ ok: null, reason: notProbed }),
    });
    const service = makeService(
      prisma,
      buildDescriptor(),
      buildTruthSweeper(),
      buildMonitoring(),
      inputStatus,
    );

    const result = await service.putScheduleService(
      'model-1',
      { enabled: true },
      user,
    );

    expect(result.statusCode).toBe(200);
    const call = prisma.inferenceSchedule.upsert.mock.calls[0][0];
    expect(call.create.preflightOk).toBeNull();
    expect(call.create.preflightReason).toBe(notProbed);
  });

  // ── MODEL-SERVE-001-T28 ──────────────────────────────────────────────────

  it('refuses a merged missingPctWarn >= missingPctAlert, not just a both-in-one-request pair', () => {
    // THE GAP THIS CLOSES: the DTO's own refine only fires when BOTH arrive
    // together. A partial update naming just one, against an existing row
    // that would put them out of order, reaches the service — the exact
    // hole T09 found for warnSd/criticalSd.
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: [],
          },
        }),
      },
      inferenceSchedule: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          autoRetrain: false,
          warnSd: 1.5,
          criticalSd: 3.0,
          driftMonitor: false,
          truthLagMinutes: 1440,
          truthToleranceMinutes: 30,
          truthHorizonHours: 168,
          missingPctWarn: 5,
          // The stored alert band is 20; the request lifts warn ABOVE it
          // while naming only warn.
          missingPctAlert: 20,
          skipStreakAlert: 3,
          frozenWindows: 3,
          frozenTolerancePct: 0,
        }),
      },
    });
    const service = makeService(prisma);
    return expect(
      service.putScheduleService(
        'model-1',
        { enabled: true, missingPctWarn: 25 },
        user,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('merges the T28 bands — updating one does not reset the others', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: [],
          },
        }),
      },
      inferenceSchedule: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          autoRetrain: false,
          warnSd: 1.5,
          criticalSd: 3.0,
          driftMonitor: false,
          truthLagMinutes: 1440,
          truthToleranceMinutes: 30,
          truthHorizonHours: 168,
          // Operator-set values already on the row.
          missingPctWarn: 7,
          missingPctAlert: 30,
          skipStreakAlert: 5,
          frozenWindows: 4,
          frozenTolerancePct: 0.02,
        }),
      },
    });
    const service = makeService(prisma);

    await service.putScheduleService(
      'model-1',
      { enabled: true, frozenWindows: 6 },
      user,
    );

    const call = prisma.inferenceSchedule.upsert.mock.calls[0][0];
    expect(call.update.frozenWindows).toBe(6);
    // The other four survive untouched — not reset to their defaults.
    expect(call.update.missingPctWarn).toBe(7);
    expect(call.update.missingPctAlert).toBe(30);
    expect(call.update.skipStreakAlert).toBe(5);
    expect(call.update.frozenTolerancePct).toBe(0.02);
  });

  // ── MODEL-SERVE-001-T14 ──────────────────────────────────────────────────

  it('derives a SMALLER per-schedule minRows for a non-1-minute PI interval', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            // 60-minute cadence (the DTO's own default) / 5-minute interval
            // = 12 rows in a complete window; half of that is 6 — NOT the
            // global 30 this schedule would have been evaluated against
            // before this task, which is the whole defect T14 exists to fix.
            sourceFetchConfigs: { 'src-a': { intervalTime: '5m' } },
            baseTags: [],
          },
        }),
      },
    });
    const service = makeService(prisma);
    const result = await service.putScheduleService(
      'model-1',
      { enabled: true },
      user,
    );
    const call = prisma.inferenceSchedule.upsert.mock.calls[0][0];
    expect(call.create.minRows).toBe(6);
    expect(result.data?.minRows).toBe(6);
  });

  it('falls back to env.INFERENCE_MIN_ROWS for a source with no interval concept (e.g. SQL)', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            // SQLConfig carries no `intervalTime` field at all — never a
            // fabricated per-schedule number derived from a guess.
            sourceFetchConfigs: {
              'src-a': { type: 'sql', connectionString: 'x', query: 'y' },
            },
            baseTags: [],
          },
        }),
      },
    });
    const service = makeService(prisma);
    const result = await service.putScheduleService(
      'model-1',
      { enabled: true },
      user,
    );
    const call = prisma.inferenceSchedule.upsert.mock.calls[0][0];
    // MODEL-SERVE-010-T02. Asserted against `env.INFERENCE_MIN_ROWS` ITSELF,
    // never a literal: this test hardcoded 30 while the default moved to 15
    // (env.config.ts), so it failed on the DEFAULT rather than on the
    // fallback BEHAVIOUR it is named for — a red test that said nothing
    // about its own subject. Reading the same constant the production path
    // reads makes the assertion "the fallback is the env default", which is
    // the actual claim and cannot drift again.
    expect(call.create.minRows).toBe(env.INFERENCE_MIN_ROWS);
    expect(result.data?.minRows).toBe(env.INFERENCE_MIN_ROWS);
  });

  it('recomputes minRows unconditionally on a settings-only update, unlike cadenceMinutes/lagMinutes', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '5m' } },
            baseTags: [],
          },
        }),
      },
      inferenceSchedule: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        // Already enabled at the OLD, global-constant floor — as every
        // schedule created before this task would be.
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          autoRetrain: false,
          warnSd: 1.5,
          criticalSd: 3.0,
          driftMonitor: false,
        }),
      },
    });
    const service = makeService(prisma);
    // A settings-only tweak that names neither cadenceMinutes nor minRows.
    await service.putScheduleService(
      'model-1',
      { enabled: true, driftMonitor: true },
      user,
    );
    const call = prisma.inferenceSchedule.upsert.mock.calls[0][0];
    // cadenceMinutes/lagMinutes are conditionally omitted from `update`
    // when the DTO does not send them (existing MERGE behaviour) — minRows
    // must NOT follow that pattern, since it tracks the CURRENT
    // fetchConfig, which this call resolved fresh regardless.
    expect(call.update.cadenceMinutes).toBeUndefined();
    expect(call.update.minRows).toBe(6);
  });

  it('stamps deployedAt/deployedBy on a fresh OFF -> ON enable', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: [],
          },
        }),
      },
    });
    const service = makeService(prisma);
    await service.putScheduleService('model-1', { enabled: true }, user);

    expect(prisma.model.update).toHaveBeenCalledTimes(1);
    const stampCall = prisma.model.update.mock.calls[0][0];
    expect(stampCall.data.data.deployedBy).toBe('Ada Lovelace');
    expect(typeof stampCall.data.data.deployedAt).toBe('string');
  });

  it('does NOT re-stamp deployedAt on a settings-only update while already enabled', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: [],
          },
        }),
      },
      inferenceSchedule: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        // Already enabled — this is a settings tweak, not a first enable.
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          autoRetrain: false,
          warnSd: 1.5,
          criticalSd: 3.0,
          driftMonitor: false,
        }),
      },
    });
    const service = makeService(prisma);
    await service.putScheduleService(
      'model-1',
      { enabled: true, driftMonitor: true },
      user,
    );
    expect(prisma.model.update).not.toHaveBeenCalled();
  });

  it('rejects a partial update that would put warnSd >= the row’s existing criticalSd (D9-adjacent server-side re-check)', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: [],
          },
        }),
      },
      inferenceSchedule: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          autoRetrain: false,
          warnSd: 1.5,
          criticalSd: 3.0,
          driftMonitor: false,
        }),
      },
    });
    const service = makeService(prisma);
    // Sends only warnSd — the DTO's own refine cannot see this violates
    // the EXISTING criticalSd (3.0), only the service-side re-check can.
    await expect(
      service.putScheduleService('model-1', { enabled: true, warnSd: 5 }, user),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.inferenceSchedule.upsert).not.toHaveBeenCalled();
  });

  it('disables without touching the descriptor at all', async () => {
    const prisma = buildPrisma();
    const descriptor = buildDescriptor();
    const service = makeService(prisma, descriptor);
    const result = await service.putScheduleService(
      'model-1',
      { enabled: false },
      user,
    );
    expect(result.statusCode).toBe(200);
    expect(prisma.inferenceSchedule.updateMany).toHaveBeenCalledWith({
      where: { modelId: 'model-1' },
      data: { enabled: false },
    });
    expect(descriptor.getDescriptorByVersionIdService).not.toHaveBeenCalled();
  });

  // MODEL-SERVE-001-T20.
  it('cancels queued PENDING windows in the same transaction as disable, and only PENDING ones', async () => {
    // Fake timers, not expect.any(Date) — a full literal match keeps this
    // test out of the same expect.objectContaining/expect.any `any`-typed
    // territory the rest of this file's toHaveBeenCalledWith calls already
    // sit in (@typescript-eslint/no-unsafe-assignment on their return type).
    const NOW = new Date('2026-09-15T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(NOW);
    try {
      const prisma = buildPrisma({
        inferenceWindow: {
          findUniqueOrThrow: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        },
      });
      const service = makeService(prisma);
      const result = await service.putScheduleService(
        'model-1',
        { enabled: false },
        user,
      );
      expect(result.statusCode).toBe(200);
      expect(result.message).toContain('3');
      // Only PENDING is targeted — a RUNNING window's container is already
      // in flight and stays owned by the reconcile sweep, never cancelled
      // out from under it.
      expect(prisma.inferenceWindow.updateMany).toHaveBeenCalledWith({
        where: { modelId: 'model-1', status: 'PENDING' },
        data: {
          status: 'CANCELED',
          failureReason: 'Schedule stopped before this window was dispatched.',
          finishedAt: NOW,
          tokenExpiresAt: new Date(0),
        },
      });
      // Both writes went through the SAME $transaction call — a disable can
      // never record as having happened while its queued rows are left
      // stranded PENDING.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('InferenceWindowAuthorizedService.getStatusService — reason surfacing (MODEL-SERVE-001-T09)', () => {
  const NOW = new Date('2026-09-14T12:00:00.000Z');
  const OLDER = new Date('2026-09-14T10:00:00.000Z');

  function statusPrisma(overrides: {
    failed?: { windowStart: Date; failureReason: string | null } | null;
    skipped?: { windowStart: Date; failureReason: string | null } | null;
  }) {
    return buildPrisma({
      inferenceSchedule: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ enabled: true, cadenceMinutes: 60 }),
      },
      inferenceWindow: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: { where: { status: unknown } }) => {
            if (where.status === 'FAILED') {
              return Promise.resolve(overrides.failed ?? null);
            }
            if (where.status === 'SKIPPED') {
              return Promise.resolve(overrides.skipped ?? null);
            }
            // The `in: [...]` reads (lastSucceeded/lastTerminal) — no
            // successful history in any of these fixtures.
            return Promise.resolve(null);
          }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    });
  }

  it('surfaces the latest FAILED reason, redacted, never the SKIPPED one', async () => {
    const prisma = statusPrisma({
      failed: {
        windowStart: NOW,
        failureReason:
          'Materialize failed: 404 for url: https://minio.local/gold/x?X-Amz-Signature=abc',
      },
      skipped: {
        windowStart: OLDER,
        failureReason: 'Only 5 usable row(s), below INFERENCE_MIN_ROWS (30).',
      },
    });
    const service = makeService(prisma);

    const result = await service.getStatusService('model-1', user);

    expect(result.data.lastFailure).toEqual({
      windowStart: NOW,
      reason: 'Materialize failed: 404 for url: [redacted url]',
    });
    expect(result.data.lastSkipped).toEqual({
      windowStart: OLDER,
      reason: 'Only 5 usable row(s), below INFERENCE_MIN_ROWS (30).',
    });
  });

  it('reports both as null when neither a FAILED nor a SKIPPED window exists', async () => {
    const prisma = statusPrisma({ failed: null, skipped: null });
    const service = makeService(prisma);

    const result = await service.getStatusService('model-1', user);

    expect(result.data.lastFailure).toBeNull();
    expect(result.data.lastSkipped).toBeNull();
  });

  it('a SKIPPED window never populates lastFailure', async () => {
    const prisma = statusPrisma({
      failed: null,
      skipped: { windowStart: OLDER, failureReason: 'below threshold' },
    });
    const service = makeService(prisma);

    const result = await service.getStatusService('model-1', user);

    expect(result.data.lastFailure).toBeNull();
    expect(result.data.lastSkipped?.reason).toBe('below threshold');
  });

  // MODEL-SERVE-001-T20.
  it('excludes CANCELED from gapCount — a deliberate stop is not a gap', async () => {
    const prisma = statusPrisma({ failed: null, skipped: null });
    const service = makeService(prisma);

    await service.getStatusService('model-1', user);

    expect(prisma.inferenceWindow.count).toHaveBeenCalledWith({
      where: {
        modelId: 'model-1',
        status: { notIn: ['SUCCEEDED', 'SKIPPED', 'CANCELED'] },
      },
    });
  });
});

describe('InferenceWindowAuthorizedService.completeService — server-built keys (MODEL-SERVE-006-T06)', () => {
  it('builds predictionsKey server-side, never trusting the container body', async () => {
    const prisma = buildPrisma({
      inferenceWindow: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'w1',
          modelId: 'model-1',
          modelVersionId: 'version-1',
          windowStart: new Date('2026-09-10T08:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const service = makeService(prisma);
    await service.completeService('w1', {
      status: 'SUCCEEDED',
      rowCount: 59,
      outputChecksum: 'abc',
      uploaded: ['predictions.parquet', 'metrics.json'],
    } as never);

    const call = prisma.inferenceWindow.update.mock.calls[0][0];
    expect(call.data.predictionsKey).toBe(
      'inference/model-1/version-1/dt=2026-09-10/hour=08/predictions.parquet',
    );
    expect(call.data.metricsKey).toBe(
      'inference/model-1/version-1/dt=2026-09-10/hour=08/metrics.json',
    );
    expect(call.data.status).toBe('SUCCEEDED');
  });

  it('omits metricsKey when metrics.json was not among the uploaded filenames', async () => {
    const prisma = buildPrisma({
      inferenceWindow: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'w1',
          modelId: 'model-1',
          modelVersionId: 'version-1',
          windowStart: new Date('2026-09-10T08:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const service = makeService(prisma);
    await service.completeService('w1', {
      status: 'SUCCEEDED',
      rowCount: 59,
      outputChecksum: 'abc',
      uploaded: ['predictions.parquet'],
    } as never);
    const call = prisma.inferenceWindow.update.mock.calls[0][0];
    expect(call.data.metricsKey).toBeNull();
  });

  it('records FAILED with the reason, never touching predictionsKey', async () => {
    const prisma = buildPrisma({
      inferenceWindow: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'w1',
          modelId: 'model-1',
          modelVersionId: 'version-1',
          windowStart: new Date('2026-09-10T08:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const service = makeService(prisma);
    await service.completeService('w1', {
      status: 'FAILED',
      failureReason: 'boom',
    } as never);
    const call = prisma.inferenceWindow.update.mock.calls[0][0];
    expect(call.data.status).toBe('FAILED');
    expect(call.data.failureReason).toBe('boom');
    expect(call.data.predictionsKey).toBeUndefined();
  });
});

describe('InferenceWindowAuthorizedService.claimService', () => {
  it('refuses to claim before the window has a materialized input', async () => {
    const prisma = buildPrisma({
      inferenceWindow: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'w1', inputKey: null, inputChecksum: null }),
      },
    });
    const service = makeService(prisma);
    await expect(service.claimService('w1')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(presignInferenceWindowObject).not.toHaveBeenCalled();
  });
});

/**
 * MODEL-SERVE-005-T03. The read side of the ground-truth join.
 *
 * These cover the refusals the live verification never touched: it drove
 * python and Prisma directly and never entered this service, so the
 * version-grouping rule — the one that decides whether a published RMSE is
 * a number about anything — had no test at any level.
 */
const RANGE = {
  from: '2026-09-14T00:00:00.000Z',
  to: '2026-09-15T00:00:00.000Z',
};

/** One truth row. Sums default to a single pair with residual +1 against an
 *  actual of 40, so a fixture states its pairs rather than six raw numbers. */
function truthRow(overrides: Record<string, unknown> = {}) {
  return {
    windowStart: new Date('2026-09-14T08:00:00.000Z'),
    modelVersionId: 'version-1',
    targetColumn: 'S204FBP.lab',
    pairsKey: 'inference/model-1/version-1/dt=2026-09-14/hour=15/truth.parquet',
    truthRows: 1,
    pairedRows: 1,
    // MODEL-SERVE-008-T04. Deliberately NOT equal to pairedRows: a fixture
    // where every prediction pairs cannot detect a strip that reports the
    // paired count where it means the scored one.
    predictionRows: 60,
    joinedThrough: new Date('2026-09-14T09:00:00.000Z'),
    failureReason: null,
    n: 1,
    sumSe: 1,
    sumAe: 1,
    sumSigned: 1,
    sumActual: 40,
    sumActualSq: 1600,
    window: { missingPct: 0.1 },
    ...overrides,
  };
}

/** `dueWindows` is what `rejoinTruthService` enumerates; `rows` is what
 *  `getTruthService` reads. Both are supplied up front rather than patched
 *  onto the double afterwards, so the stub keeps its declared shape. */
function buildTruthPrisma(
  rows: Array<ReturnType<typeof truthRow>>,
  windowsInRange = rows.length,
  dueWindows: Array<{ id: string }> = [],
  // T11: getTruthService now issues a SECOND, distinct `count` — the fourth
  // empty cause (SKIPPED windows the SUCCEEDED-only windowsInRange count
  // cannot see). Keyed by `where.status`, same discipline `statusPrisma`
  // above already applies to its own dual-branch `findFirst` mock, so the
  // two counts can differ instead of silently sharing one value.
  windowsSkipped = 0,
  // MODEL-SERVE-001-T18: `getTruthService`'s OWN `earliestEligibleAt` query
  // is a SECOND, differently-shaped `inferenceWindow.findMany` call
  // (`select: { windowEnd, truth }`, never `select: { id }`) sharing the
  // same mocked method as `rejoinTruthService`'s `dueWindows` enumeration.
  // Keyed by `select.id` presence, the same discriminate-by-shape
  // discipline `count` above already uses for its own two callers.
  awaitingWindows: Array<{
    windowEnd: Date;
    truth: { n: number; failureReason: string | null } | null;
  }> = [],
) {
  return buildPrisma({
    inferenceWindowTruth: { findMany: jest.fn().mockResolvedValue(rows) },
    // MODEL-SERVE-009-T05. `getTruthService` reads the TARGET's own per-tag
    // row to publish its held value. Null by default — a model whose
    // scheduled fetch has not run yet — so `targetHeld` comes back null
    // rather than the mock throwing and hiding the real behaviour.
    tagObservation: { findUnique: jest.fn().mockResolvedValue(null) },
    inferenceWindow: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      count: jest
        .fn()
        .mockImplementation(({ where }: { where: { status: unknown } }) =>
          Promise.resolve(
            where.status === 'SKIPPED' ? windowsSkipped : windowsInRange,
          ),
        ),
      findMany: jest
        .fn()
        .mockImplementation(({ select }: { select?: { id?: boolean } } = {}) =>
          Promise.resolve(select?.id ? dueWindows : awaitingWindows),
        ),
    },
  });
}

describe('InferenceWindowAuthorizedService.getTruthService (MODEL-SERVE-005-T03)', () => {
  beforeEach(() => {
    jest
      .mocked(inferenceWindowTruthSeries)
      .mockResolvedValue({ points: [], truncated: false });
  });

  it('publishes pooled metrics when the range speaks with ONE version', async () => {
    const service = makeService(
      buildTruthPrisma([
        truthRow(),
        truthRow({
          windowStart: new Date('2026-09-14T09:00:00.000Z'),
          n: 1,
          sumSe: 4,
          sumAe: 2,
          sumSigned: -2,
          sumActual: 44,
          sumActualSq: 1936,
        }),
      ]),
    );

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.mixedVersions).toBe(false);
    expect(res.data.versions).toHaveLength(1);
    // Pooled over both windows: n = 2, sumSe = 5 -> RMSE = sqrt(2.5).
    expect(res.data.metrics!.n).toBe(2);
    expect(res.data.metrics!.rmse).toBeCloseTo(Math.sqrt(2.5), 10);
    expect(res.data.metrics!.bias).toBeCloseTo(-0.5, 10);
  });

  /** The case the whole grouping rule exists for. MODEL-SERVE-006-T07
   *  deliberately allows two versions to score one windowStart, and each
   *  version's target is resolved through its OWN sourceRun — so two
   *  versions in one range can carry different targets, and a single
   *  pooled RMSE over them would be a number about nothing. */
  it('REFUSES a single metric when two versions are in range', async () => {
    const service = makeService(
      buildTruthPrisma([
        truthRow(),
        truthRow({
          modelVersionId: 'version-2',
          targetColumn: 'S301OUT.lab',
          n: 2,
          sumSe: 8,
          sumAe: 4,
          sumSigned: 4,
          sumActual: 100,
          sumActualSq: 5008,
        }),
      ]),
    );

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.metrics).toBeNull();
    expect(res.data.mixedVersions).toBe(true);
    expect(res.data.versions).toHaveLength(2);
    // Each group keeps its own target, so a caller can say which is which
    // instead of being handed one unlabelled figure.
    expect(res.data.versions.map((v) => v.targetColumn).sort()).toEqual([
      'S204FBP.lab',
      'S301OUT.lab',
    ]);
    expect(res.data.versions.every((v) => v.metrics !== null)).toBe(true);
  });

  it('reports NO error — not zero — when nothing has joined yet', async () => {
    const service = makeService(buildTruthPrisma([], 5));

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.metrics).toBeNull();
    expect(res.data.versions).toHaveLength(0);
    expect(res.data.coverage.windowsInRange).toBe(5);
    expect(res.data.coverage.windowsJoined).toBe(0);
    expect(res.data.coverage.windowsAwaitingTruth).toBe(5);
  });

  /**
   * T11. `windowsInRange` counts SUCCEEDED only, so an all-SKIPPED range
   * read as "no completed windows" — identical to "the scheduler never ran
   * here" — even though it ran, fetched, and deliberately declined to
   * score. `windowsSkipped` is the fact that lets a caller tell the two
   * apart; it must be independent of, not derived from, windowsInRange.
   */
  it('reports windowsSkipped independently of windowsInRange (the fourth empty cause)', async () => {
    const service = makeService(buildTruthPrisma([], 0, [], 3));

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.coverage.windowsInRange).toBe(0);
    expect(res.data.coverage.windowsSkipped).toBe(3);
  });

  /** A failure row exists to stop the sweeper starving on an unjoinable
   *  window. It must never reach a metric, and must stay distinguishable
   *  from a window the lab simply has not reported on. */
  it('excludes a FAILED join from metrics but counts it as failed', async () => {
    const service = makeService(
      buildTruthPrisma(
        [
          truthRow(),
          truthRow({
            windowStart: new Date('2026-09-14T10:00:00.000Z'),
            targetColumn: null,
            pairsKey: null,
            truthRows: 0,
            pairedRows: 0,
            n: 0,
            sumSe: 0,
            sumAe: 0,
            sumSigned: 0,
            sumActual: 0,
            sumActualSq: 0,
            failureReason: 'ModelVersion version-1 has no target column',
          }),
        ],
        2,
      ),
    );

    const res = await service.getTruthService('model-1', RANGE, user);

    // The zeros of the failure row do not dilute the real pair.
    expect(res.data.metrics!.n).toBe(1);
    expect(res.data.metrics!.rmse).toBeCloseTo(1, 10);
    expect(res.data.coverage.windowsJoined).toBe(1);
    expect(res.data.coverage.windowsFailed).toBe(1);
    // Disjoint: the failed window is NOT also counted as awaiting the lab,
    // or the two chips in the coverage strip would contradict each other.
    expect(res.data.coverage.windowsAwaitingTruth).toBe(0);
    expect(
      res.data.windows.find((w) => w.failureReason !== null),
    ).toBeDefined();
  });

  it('surfaces the target even when no window has joined anything', async () => {
    const service = makeService(
      buildTruthPrisma([
        truthRow({
          truthRows: 0,
          pairedRows: 0,
          pairsKey: null,
          n: 0,
          sumSe: 0,
          sumAe: 0,
          sumSigned: 0,
          sumActual: 0,
          sumActualSq: 0,
        }),
      ]),
    );

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.metrics).toBeNull();
    // Knowable before any truth arrives, so the UI keeps its target label
    // rather than losing it while waiting for the first lab sample.
    expect(res.data.targetColumn).toBe('S204FBP.lab');
  });

  /** MODEL-SERVE-006-T05's stated reason for missingPct is telling real
   *  drift apart from a sensor that stopped reporting. A mean would hide
   *  the one catastrophic window that is exactly that signal. */
  it('reports the MAX missing rate, never a mean', async () => {
    const service = makeService(
      buildTruthPrisma([
        truthRow({ window: { missingPct: 0.02 } }),
        truthRow({
          windowStart: new Date('2026-09-14T09:00:00.000Z'),
          window: { missingPct: 0.91 },
        }),
      ]),
    );

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.coverage.maxMissingPct).toBeCloseTo(0.91, 10);
  });

  it('keeps metrics and coverage when the pairs objects cannot be read', async () => {
    jest
      .mocked(inferenceWindowTruthSeries)
      .mockRejectedValue(new Error('object store unreachable'));
    const service = makeService(buildTruthPrisma([truthRow()]));

    const res = await service.getTruthService('model-1', RANGE, user);

    // The chart loses its points; the numbers from Postgres are still true.
    expect(res.data.points).toEqual([]);
    expect(res.data.metrics!.n).toBe(1);
    expect(res.data.coverage.windowsJoined).toBe(1);
  });

  // ── MODEL-SERVE-009-T05: the target's held value, never a pair ───────────

  it("publishes the target's LAST REPORTED value and when it was actually measured", async () => {
    const prisma = buildTruthPrisma([truthRow()], 1);
    prisma.tagObservation.findUnique.mockResolvedValue({
      tag: 'S204FBP.lab',
      lastValue: 41.5,
      // Measured two days before it was last SEEN — the gap is the point.
      lastChangedAt: new Date('2026-09-15T07:59:00.000Z'),
      lastSeenAt: new Date('2026-09-17T03:59:00.000Z'),
    });
    const service = makeService(prisma);

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.targetHeld).toMatchObject({
      tag: 'S204FBP.lab',
      value: 41.5,
      lastMeasuredAt: '2026-09-15T07:59:00.000Z',
      lastSeenAt: '2026-09-17T03:59:00.000Z',
    });
    // Sep 15 07:59 -> Sep 17 03:59 is 44 hours, not 48: 2640 minutes held
    // at the same number.
    expect(res.data.targetHeld!.heldForMinutes).toBe(2640);
  });

  it('NEVER turns the held value into a pair — metrics stay driven by joined rows alone', async () => {
    // A range with NO joined pairs but a held target value present. The
    // target tag is resolved from the PRODUCTION version, because there is
    // no joined row to read it off — which is the whole point: this is the
    // state the held value matters in.
    const prisma = buildTruthPrisma([], 1);
    prisma.modelVersion.findFirst.mockResolvedValue({
      sourceRun: { targetY: 'S204FBP.lab' },
    });
    prisma.tagObservation.findUnique.mockResolvedValue({
      tag: 'S204FBP.lab',
      lastValue: 41.5,
      lastChangedAt: new Date('2026-09-15T07:59:00.000Z'),
      lastSeenAt: new Date('2026-09-17T03:59:00.000Z'),
    });
    const service = makeService(prisma);

    const res = await service.getTruthService('model-1', RANGE, user);

    // The held number is published, and the error metrics remain absent —
    // publishing an R2 against a value nobody measured is the specific
    // defect the EventWeighted Count probe exists to prevent.
    expect(res.data.targetHeld!.value).toBe(41.5);
    expect(res.data.metrics).toBeNull();
    expect(res.data.coverage.pairedRows).toBe(0);
    expect(res.data.points).toEqual([]);
  });

  it('is null when no scheduled fetch has recorded the target yet', async () => {
    const service = makeService(buildTruthPrisma([truthRow()], 1));

    const res = await service.getTruthService('model-1', RANGE, user);

    // Null, not a zero or a fabricated timestamp.
    expect(res.data.targetHeld).toBeNull();
  });

  // ── MODEL-SERVE-008-T04: the scored count, beside the lab count ──────────

  it('reports predictions PRODUCED separately from predictions PAIRED, so a sparse actual cannot read as a rare run', async () => {
    // Two windows, 60 predictions each, one lab sample each. This is the
    // real shape on a once-a-day target scored hourly: the scored side
    // dwarfs the paired side, and the chart shows only the paired side.
    const prisma = buildTruthPrisma([truthRow(), truthRow()], 2);
    prisma.inferenceSchedule.findUnique.mockResolvedValue({
      truthLagMinutes: 1440,
      cadenceMinutes: 60,
    });
    const service = makeService(prisma);

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.coverage.predictionRows).toBe(120);
    expect(res.data.coverage.pairedRows).toBe(2);
    expect(res.data.coverage.truthRows).toBe(2);
    // The rate the reader cannot infer from the points themselves.
    expect(res.data.coverage.cadenceMinutes).toBe(60);
  });

  it('leaves cadenceMinutes null with no schedule — the question has no answer, not a default one', async () => {
    const service = makeService(buildTruthPrisma([truthRow()], 1));

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.coverage.cadenceMinutes).toBeNull();
    // The scored count is a property of the rows, not of the schedule, so
    // it survives a model that has none.
    expect(res.data.coverage.predictionRows).toBe(60);
  });

  // ── MODEL-SERVE-001-T18: naming WHEN the next truth check happens ────────

  // MODEL-SERVE-008-T01. These fixtures describe windows still INSIDE their
  // lab window, which is now a claim about the clock and not only about the
  // rows — an expired lag produces a different state on purpose. Pinning
  // the clock is what keeps them testing their own subject: without it they
  // passed in 2026-09 and would have started asserting the lapsed branch as
  // real time moved past the fixture dates.
  const NOW_INSIDE_LAG = new Date('2026-09-14T12:00:00.000Z');
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW_INSIDE_LAG);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('names the earliest eligible time for a window that has not joined yet', async () => {
    const prisma = buildTruthPrisma([], 1, [], 0, [
      { windowEnd: new Date('2026-09-14T09:00:00.000Z'), truth: null },
    ]);
    prisma.inferenceSchedule.findUnique.mockResolvedValue({
      truthLagMinutes: 1440,
    });
    const service = makeService(prisma);

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.coverage.truthLagMinutes).toBe(1440);
    // windowEnd (09:00) + 1440 minutes (24h) = the next day, same clock time.
    expect(res.data.coverage.earliestEligibleAt).toBe(
      '2026-09-15T09:00:00.000Z',
    );
  });

  it('takes the EARLIEST of several still-awaiting windows, not the first in the array', async () => {
    const prisma = buildTruthPrisma([], 2, [], 0, [
      { windowEnd: new Date('2026-09-14T10:00:00.000Z'), truth: null },
      // A real attempt that found nothing YET (n = 0, no failureReason) is
      // still "awaiting", same as no truth row at all — and it is earlier.
      {
        windowEnd: new Date('2026-09-14T08:00:00.000Z'),
        truth: { n: 0, failureReason: null },
      },
    ]);
    prisma.inferenceSchedule.findUnique.mockResolvedValue({
      truthLagMinutes: 60,
    });
    // A one-hour lag puts both fixtures' deadlines (09:00 and 11:00) in the
    // past under this block's default clock, which is the LAPSED state, not
    // this test's subject. Stand before the earlier of the two.
    jest.setSystemTime(new Date('2026-09-14T08:30:00.000Z'));
    const service = makeService(prisma);

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.coverage.earliestEligibleAt).toBe(
      '2026-09-14T09:00:00.000Z',
    );
    // Both are still inside the lab's window — neither has lapsed.
    expect(res.data.coverage.windowsLapsedTruth).toBe(0);
  });

  // ── MODEL-SERVE-008-T01: the lag EXPIRED and the lab never reported ──────

  it('counts a window whose lag has expired as lapsed, and refuses to name a deadline that has already passed', async () => {
    const prisma = buildTruthPrisma([], 1, [], 0, [
      // Joined honestly: the sweeper reached the source, the lab had
      // nothing in this window. Before T01 this row stayed "awaiting"
      // forever and earliestEligibleAt named a time in the past.
      {
        windowEnd: new Date('2026-09-13T09:00:00.000Z'),
        truth: { n: 0, failureReason: null },
      },
    ]);
    prisma.inferenceSchedule.findUnique.mockResolvedValue({
      truthLagMinutes: 1440,
    });
    const service = makeService(prisma);

    // Deadline was 2026-09-14T09:00Z; the clock stands three hours past it.
    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.coverage.windowsLapsedTruth).toBe(1);
    expect(res.data.coverage.earliestEligibleAt).toBeNull();
  });

  it('separates a lapsed window from one still inside its lag, rather than pooling them', async () => {
    const prisma = buildTruthPrisma([], 2, [], 0, [
      // Deadline 2026-09-14T09:00Z — passed.
      {
        windowEnd: new Date('2026-09-13T09:00:00.000Z'),
        truth: { n: 0, failureReason: null },
      },
      // Deadline 2026-09-15T06:00Z — still ahead of the clock.
      { windowEnd: new Date('2026-09-14T06:00:00.000Z'), truth: null },
    ]);
    prisma.inferenceSchedule.findUnique.mockResolvedValue({
      truthLagMinutes: 1440,
    });
    const service = makeService(prisma);

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.coverage.windowsLapsedTruth).toBe(1);
    // The time named is the PENDING one's, never the lapsed one's earlier
    // and already-passed deadline.
    expect(res.data.coverage.earliestEligibleAt).toBe(
      '2026-09-15T06:00:00.000Z',
    );
  });

  it('is null when every window in range has already joined or failed — nothing is awaiting', async () => {
    const prisma = buildTruthPrisma([], 1, [], 0, [
      {
        windowEnd: new Date('2026-09-14T09:00:00.000Z'),
        truth: { n: 1, failureReason: null },
      },
    ]);
    prisma.inferenceSchedule.findUnique.mockResolvedValue({
      truthLagMinutes: 1440,
    });
    const service = makeService(prisma);

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.coverage.earliestEligibleAt).toBeNull();
  });

  it('is null with no InferenceSchedule row at all — the wait has no meaning without one', async () => {
    // Every OTHER test in this describe block already exercises the
    // default `inferenceSchedule.findUnique` -> null (buildPrisma's own
    // default); this test states that behaviour explicitly rather than
    // leaving it merely implied by every other test's silence.
    const service = makeService(
      buildTruthPrisma([], 1, [], 0, [
        { windowEnd: new Date('2026-09-14T09:00:00.000Z'), truth: null },
      ]),
    );

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.coverage.truthLagMinutes).toBeNull();
    expect(res.data.coverage.earliestEligibleAt).toBeNull();
  });
});

describe('InferenceWindowAuthorizedService.rejoinTruthService (MODEL-SERVE-005-T03)', () => {
  it('drives the SAME sweeper path, once per window in range', async () => {
    const prisma = buildTruthPrisma([], 0, [
      { id: 'window-1' },
      { id: 'window-2' },
    ]);
    const sweeper = buildTruthSweeper();
    const service = makeService(prisma, buildDescriptor(), sweeper);

    const res = await service.rejoinTruthService('model-1', RANGE, user);

    expect(sweeper.joinWindow).toHaveBeenCalledTimes(2);
    expect(res.data).toMatchObject({ requested: 2, rejoined: 2, failed: 0 });
  });

  it('reports a failed window instead of abandoning the rest of the range', async () => {
    const prisma = buildTruthPrisma([], 0, [
      { id: 'window-1' },
      { id: 'window-2' },
    ]);
    const sweeper = buildTruthSweeper({
      joinWindow: jest
        .fn()
        .mockRejectedValueOnce(new Error('source unreachable'))
        .mockResolvedValueOnce(undefined),
    });
    const service = makeService(prisma, buildDescriptor(), sweeper);

    const res = await service.rejoinTruthService('model-1', RANGE, user);

    expect(res.data.rejoined).toBe(1);
    expect(res.data.failed).toBe(1);
    expect(res.data.failures[0]).toContain('source unreachable');
  });
});

// ── MODEL-SERVE-001-T10 ────────────────────────────────────────────────────

/** The exact shape `train.py`'s top-level handler produces when
 *  `download_verified` fails against a presigned object URL: `requests`
 *  embeds the whole URL, query string included, in the HTTPError text. */
const PRESIGNED_FAILURE =
  '404 Client Error: Not Found for url: ' +
  'https://minio:9000/artifacts/model.joblib' +
  '?X-Amz-Credential=AKIAEXAMPLE%2F20260914%2Fus-east-1' +
  '&X-Amz-Signature=deadbeefcafe';

const WINDOW_ROW = {
  id: 'window-1',
  status: 'FAILED',
  windowStart: new Date('2026-09-14T10:00:00.000Z'),
  windowEnd: new Date('2026-09-14T11:00:00.000Z'),
  inputRows: 60,
  missingPct: 0,
  imageDigest: 'sha256:abc',
  containerId: null as string | null,
  failureReason: null as string | null,
  attempts: 1,
  startedAt: null,
  finishedAt: null,
};

interface LogLine {
  id: string;
  level: string;
  message: string;
  createdAt: Date;
}

/** Returns the mock handles alongside the double: asserting through
 *  `prisma.inferenceWindow.findFirst.mock` would reach through an untyped
 *  index signature, which is what `no-unsafe-member-access` is for. */
function buildLogPrisma(
  logs: LogLine[],
  windowOverrides: Record<string, unknown> = {},
  prismaOverrides: Record<string, unknown> = {},
) {
  const windowFindFirst = jest
    .fn()
    .mockResolvedValue({ ...WINDOW_ROW, ...windowOverrides });
  // The service reads newest-first; the double must behave that way too or
  // the reverse-for-display assertion below proves nothing.
  const logFindMany = jest
    .fn()
    .mockImplementation(({ take }: { take: number }) => {
      const newestFirst = [...logs].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return Promise.resolve(newestFirst.slice(0, take));
    });
  const logCount = jest.fn().mockResolvedValue(logs.length);

  // `windowProvenance` reads the version/promoter behind the window and the
  // model's own deploy stamp — B3 items (1) and (2).
  const windowFindUnique = jest.fn().mockResolvedValue({
    modelVersion: {
      version: 3,
      stage: 'PRODUCTION',
      promotedAt: new Date('2026-09-13T08:00:00.000Z'),
      promotionOverride: null,
      promotedBy: { firstName: 'Ada', lastName: 'Lovelace' },
    },
  });

  const prisma = buildPrisma({
    inferenceWindow: {
      findFirst: windowFindFirst,
      findUnique: windowFindUnique,
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    inferenceWindowLog: { findMany: logFindMany, count: logCount },
    ...prismaOverrides,
  });

  return { prisma, windowFindFirst, windowFindUnique, logFindMany, logCount };
}

interface WindowFindFirstArgs {
  where: unknown;
  orderBy: unknown;
  select: Record<string, unknown>;
}

/** `mock.calls[0]` is `any`; narrowing the whole array once keeps every
 *  assertion below type-safe without an eslint-disable. */
function firstCallArgs(mock: jest.Mock): WindowFindFirstArgs {
  const calls = mock.mock.calls as Array<[WindowFindFirstArgs]>;
  return calls[0][0];
}

function line(n: number, message = `line ${n}`, level = 'info'): LogLine {
  return {
    id: `log-${n}`,
    level,
    message,
    createdAt: new Date(Date.UTC(2026, 8, 14, 10, 0, n)),
  };
}

describe('InferenceWindowAuthorizedService.listLogsService — redaction (MODEL-SERVE-001-T10)', () => {
  it('strips a presigned URL out of a container log line', async () => {
    const { prisma } = buildLogPrisma([line(1, PRESIGNED_FAILURE, 'error')]);
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.lines[0].message).not.toContain('X-Amz-Signature');
    expect(res.data.lines[0].message).not.toContain('https://');
    expect(res.data.lines[0].message).toContain('[redacted url]');
  });

  it('strips a presigned URL out of the window failureReason too', async () => {
    // train.py passes ONE str(err) to _api.log AND _api.report_failure, so
    // closing only the log sink would leave the same credential on the row.
    const { prisma } = buildLogPrisma([], {
      failureReason: PRESIGNED_FAILURE,
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.window.failureReason).not.toContain('X-Amz-Signature');
    expect(res.data.window.failureReason).toContain('[redacted url]');
  });

  it('leaves a failureReason that carries no URL untouched', async () => {
    const { prisma } = buildLogPrisma([], {
      failureReason: 'Input parquet has zero rows — nothing to score.',
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.window.failureReason).toBe(
      'Input parquet has zero rows — nothing to score.',
    );
  });

  it('never returns the window tokenHash', async () => {
    const { prisma, windowFindFirst } = buildLogPrisma([line(1)]);
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.window).not.toHaveProperty('tokenHash');
    expect(firstCallArgs(windowFindFirst).select.tokenHash).toBeUndefined();
  });
});

describe('InferenceWindowAuthorizedService.listLogsService — the cap is taken from the newest end (MODEL-SERVE-001-T10)', () => {
  it('keeps the NEWEST 500 lines, not the first 500, and reports what it dropped', async () => {
    const logs = Array.from({ length: 620 }, (_, i) => line(i + 1));
    const { prisma } = buildLogPrisma(logs);
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.lines).toHaveLength(500);
    expect(res.data.truncated).toBe(true);
    expect(res.data.omittedCount).toBe(120);
    // The tail is where a FAILED window's failure actually is — the whole
    // reason this does not copy the training read's asc + take.
    expect(res.data.lines[499].message).toBe('line 620');
    // ...and it is still oldest-first for display.
    expect(res.data.lines[0].message).toBe('line 121');
  });

  it('reads one row past the cap rather than counting on every request', async () => {
    const { prisma, logFindMany, logCount } = buildLogPrisma([
      line(1),
      line(2),
    ]);
    const service = makeService(prisma);

    await service.listLogsService('model-1', 'window-1', user);

    expect(logFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 501, orderBy: { createdAt: 'desc' } }),
    );
    expect(logCount).not.toHaveBeenCalled();
  });

  it('does not claim truncation at exactly the cap', async () => {
    const logs = Array.from({ length: 500 }, (_, i) => line(i + 1));
    const { prisma } = buildLogPrisma(logs);
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.lines).toHaveLength(500);
    expect(res.data.truncated).toBe(false);
    expect(res.data.omittedCount).toBe(0);
  });
});

describe('InferenceWindowAuthorizedService.listLogsService — one endpoint serves the peek and the tab (MODEL-SERVE-001-T10)', () => {
  it('resolves `latest` to the model’s most recent window', async () => {
    const { prisma, windowFindFirst } = buildLogPrisma([line(1)]);
    const service = makeService(prisma);

    await service.listLogsService('model-1', 'latest', user);

    const args = firstCallArgs(windowFindFirst);
    expect(args.where).toEqual({ modelId: 'model-1' });
    expect(args.orderBy).toEqual({ windowStart: 'desc' });
  });

  it('scopes an explicit window id to the model, so a foreign id cannot be read', async () => {
    const { prisma, windowFindFirst } = buildLogPrisma([line(1)]);
    const service = makeService(prisma);

    await service.listLogsService('model-1', 'window-9', user);

    expect(firstCallArgs(windowFindFirst).where).toEqual({
      id: 'window-9',
      modelId: 'model-1',
    });
  });

  it('says the model has no windows yet, rather than "not found", for `latest`', async () => {
    const { prisma, windowFindFirst } = buildLogPrisma([]);
    windowFindFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    await expect(
      service.listLogsService('model-1', 'latest', user),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: 'This model has no inference windows yet',
    });
  });

  it('404s an unknown explicit window id', async () => {
    const { prisma, windowFindFirst } = buildLogPrisma([]);
    windowFindFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    await expect(
      service.listLogsService('model-1', 'window-9', user),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: 'Inference window not found',
    });
  });

  it('refuses a viewer, before reading any log row', async () => {
    const { prisma, logFindMany } = buildLogPrisma(
      [line(1)],
      {},
      {
        workspace: { findFirst: jest.fn().mockResolvedValue(null) },
        workspaceMember: {
          findFirst: jest.fn().mockResolvedValue({ role: 'VIEWER' }),
        },
      },
    );
    const service = makeService(prisma);

    await expect(
      service.listLogsService('model-1', 'window-1', {
        id: 'user-2',
        role: 'USER',
      } as unknown as Auth.UserPayload),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(logFindMany).not.toHaveBeenCalled();
  });
});

describe('InferenceWindowAuthorizedService.listLogsService — a zero-line window still carries its facts (MODEL-SERVE-001-T10)', () => {
  // A console that shows only stdout cannot explain a window that never
  // spawned a container, which is most of TM2's history. Each of these
  // returns zero lines for a DIFFERENT reason, and the row is what lets the
  // client tell them apart instead of rendering one em dash.
  it.each([
    ['PENDING', null],
    ['SKIPPED', 'Only 3 row(s) in window, below INFERENCE_MIN_ROWS'],
    ['FAILED', 'Materialize failed before the container was spawned'],
    ['RUNNING', null],
  ])(
    'returns the window row for a %s window with no lines',
    async (status, failureReason) => {
      const { prisma } = buildLogPrisma([], { status, failureReason });
      const service = makeService(prisma);

      const res = await service.listLogsService('model-1', 'window-1', user);

      expect(res.data.lines).toEqual([]);
      expect(res.data.truncated).toBe(false);
      expect(res.data.window.status).toBe(status);
      expect(res.data.window.failureReason).toBe(failureReason);
      // imageDigest is null for a window that never ran a container — the
      // client's fourth discriminator.
      expect(res.data.window).toHaveProperty('imageDigest');
    },
  );
});

describe('InferenceWindowAuthorizedService.listLogsService — the span starts at Deploy (MODEL-SERVE-001-T10, B3)', () => {
  it('carries the promote that preceded the window, with its actor', async () => {
    const { prisma } = buildLogPrisma([line(1)]);
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.provenance.version).toBe(3);
    expect(res.data.provenance.stage).toBe('PRODUCTION');
    expect(res.data.provenance.promotedBy).toBe('Ada Lovelace');
  });

  it('carries the schedule enable stamp off Model.data', async () => {
    const { prisma } = buildLogPrisma(
      [line(1)],
      {},
      {
        model: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'model-1',
            workspaceId: 'ws-1',
            data: {
              deployedBy: 'Grace Hopper',
              deployedAt: '2026-09-13T09:00:00.000Z',
            },
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      },
    );
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.provenance.deployedBy).toBe('Grace Hopper');
    expect(res.data.provenance.deployedAt).toBe('2026-09-13T09:00:00.000Z');
  });

  it('surfaces the r2-floor override reason — an override with no trace is no floor', async () => {
    const { prisma, windowFindUnique } = buildLogPrisma([line(1)]);
    windowFindUnique.mockResolvedValue({
      modelVersion: {
        version: 4,
        stage: 'PRODUCTION',
        promotedAt: new Date('2026-09-13T08:00:00.000Z'),
        promotionOverride: {
          actorId: 'user-1',
          actorName: 'Ada Lovelace',
          reason: 'Accepted for a trial run on a quiet unit',
          at: '2026-09-13T08:00:00.000Z',
        },
        promotedBy: { firstName: 'Ada', lastName: 'Lovelace' },
      },
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.provenance.promotionOverrideReason).toBe(
      'Accepted for a trial run on a quiet unit',
    );
  });

  it('redacts a URL pasted into an override reason', async () => {
    const { prisma, windowFindUnique } = buildLogPrisma([line(1)]);
    windowFindUnique.mockResolvedValue({
      modelVersion: {
        version: 4,
        stage: 'PRODUCTION',
        promotedAt: null,
        promotionOverride: { reason: `see ${PRESIGNED_FAILURE}` },
        promotedBy: null,
      },
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.provenance.promotionOverrideReason).not.toContain(
      'X-Amz-Signature',
    );
  });

  it('still returns logs when the deploy stamp and promoter are absent', async () => {
    // A model deployed before the stamp existed, or whose promoter was
    // deleted, must still have readable logs — provenance is soft.
    const { prisma, windowFindUnique } = buildLogPrisma([line(1)]);
    windowFindUnique.mockResolvedValue({
      modelVersion: {
        version: 1,
        stage: 'PRODUCTION',
        promotedAt: null,
        promotionOverride: null,
        promotedBy: null,
      },
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.lines).toHaveLength(1);
    expect(res.data.provenance.deployedBy).toBeNull();
    expect(res.data.provenance.promotedBy).toBeNull();
    expect(res.data.provenance.promotionOverrideReason).toBeNull();
  });
});

describe('InferenceWindowAuthorizedService.listLogsService — containerId is the ran/did-not-run discriminator (MODEL-SERVE-001-T10)', () => {
  // VERIFIED LIVE 2026-09-14 against TM2: 20 of its 50 FAILED windows carry
  // a containerId and a startedAt while imageDigest is STILL NULL. The
  // client splits its FAILED sentence on containerId, so this endpoint has
  // to return it or that distinction is unrenderable.
  it('returns containerId so a spawned-but-silent window is distinguishable', async () => {
    const { prisma } = buildLogPrisma([], {
      status: 'FAILED',
      containerId: 'd4d86b385dd0',
      imageDigest: null,
      startedAt: new Date('2026-09-14T10:01:00.000Z'),
      failureReason:
        'Container d4d86b385dd0 no longer exists — the server restarted while this window was in flight.',
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.lines).toEqual([]);
    expect(res.data.window.containerId).toBe('d4d86b385dd0');
    expect(res.data.window.imageDigest).toBeNull();
  });

  it('returns a null containerId for a window that never spawned one', async () => {
    const { prisma } = buildLogPrisma([], {
      status: 'FAILED',
      containerId: null,
      imageDigest: null,
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.window.containerId).toBeNull();
  });
});

/**
 * MODEL-SERVE-011-V01. `runNowService` — the manual bypass of the tick wait.
 * Every case here asserts a REFUSAL the scheduled path already applies, plus
 * the one genuinely new thing: the window is inserted at the SAME aligned
 * boundary `windowStartsBetween` produces, and dispatched exactly once.
 */
describe('InferenceWindowAuthorizedService.runNowService (MODEL-SERVE-011)', () => {
  /** 60-minute cadence, no lag — so `now - cadence` always contains at
   *  least one aligned boundary and the happy path is not clock-dependent. */
  const schedule = {
    modelId: 'model-1',
    enabled: true,
    cadenceMinutes: 60,
    lagMinutes: 0,
  };

  function serviceWith(
    prisma: ReturnType<typeof buildPrisma>,
    scheduler: ReturnType<typeof buildScheduler>,
    livePredict: ReturnType<typeof buildLivePredict> = buildLivePredict(),
  ) {
    return makeService(
      prisma,
      buildDescriptor(),
      buildTruthSweeper(),
      buildMonitoring(),
      buildInputStatus(),
      scheduler,
      livePredict,
    );
  }

  it('refuses when the model has no inference schedule', async () => {
    const prisma = buildPrisma();
    prisma.inferenceSchedule.findUnique.mockResolvedValue(null);
    await expect(
      makeService(prisma).runNowService('model-1', user),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a stopped schedule rather than starting it', async () => {
    const prisma = buildPrisma();
    prisma.inferenceSchedule.findUnique.mockResolvedValue({
      ...schedule,
      enabled: false,
    });
    await expect(
      makeService(prisma).runNowService('model-1', user),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.inferenceWindow.createMany).not.toHaveBeenCalled();
  });

  it('refuses when there is no PRODUCTION version to pin the window to', async () => {
    const prisma = buildPrisma();
    prisma.inferenceSchedule.findUnique.mockResolvedValue(schedule);
    prisma.modelVersion.findFirst.mockResolvedValue(null);
    await expect(
      makeService(prisma).runNowService('model-1', user),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.inferenceWindow.createMany).not.toHaveBeenCalled();
  });

  it('inserts one epoch-aligned PENDING window and dispatches it once', async () => {
    const prisma = buildPrisma();
    prisma.inferenceSchedule.findUnique.mockResolvedValue(schedule);
    prisma.modelVersion.findFirst.mockResolvedValue({ id: 'ver-1' });
    prisma.inferenceWindow.findUniqueOrThrow.mockResolvedValue({
      id: 'win-1',
      status: 'PENDING',
      windowStart: new Date('2026-09-17T04:00:00.000Z'),
      windowEnd: new Date('2026-09-17T05:00:00.000Z'),
    });
    const scheduler = buildScheduler();

    const res = await serviceWith(prisma, scheduler).runNowService(
      'model-1',
      user,
    );

    expect(res.statusCode).toBe(202);
    expect(res.data).toMatchObject({ windowId: 'win-1', dispatched: true });
    expect(scheduler.dispatchOne).toHaveBeenCalledTimes(1);
    expect(scheduler.dispatchOne).toHaveBeenCalledWith('win-1');

    // ONE row, PENDING, skipDuplicates — and its windowStart is a multiple
    // of the cadence since the epoch, which is what lets the unique
    // constraint collapse a repeat call onto the same slot.
    const insert = (
      prisma.inferenceWindow.createMany.mock.calls as unknown as [
        {
          data: { windowStart: Date; windowEnd: Date; status: string }[];
          skipDuplicates: boolean;
        },
      ][]
    )[0][0];
    expect(insert.skipDuplicates).toBe(true);
    expect(insert.data).toHaveLength(1);
    expect(insert.data[0].status).toBe('PENDING');
    expect(insert.data[0].windowStart.getTime() % (60 * 60_000)).toBe(0);
    expect(insert.data[0].windowEnd.getTime()).toBe(
      insert.data[0].windowStart.getTime() + 60 * 60_000,
    );
  });

  it('reports an already-run window instead of dispatching a second container', async () => {
    const prisma = buildPrisma();
    prisma.inferenceSchedule.findUnique.mockResolvedValue(schedule);
    prisma.modelVersion.findFirst.mockResolvedValue({ id: 'ver-1' });
    prisma.inferenceWindow.createMany.mockResolvedValue({ count: 0 });
    prisma.inferenceWindow.findUniqueOrThrow.mockResolvedValue({
      id: 'win-1',
      status: 'SUCCEEDED',
      windowStart: new Date('2026-09-17T04:00:00.000Z'),
      windowEnd: new Date('2026-09-17T05:00:00.000Z'),
    });
    const scheduler = buildScheduler();

    const res = await serviceWith(prisma, scheduler).runNowService(
      'model-1',
      user,
    );

    expect(res.statusCode).toBe(200);
    expect(res.data).toMatchObject({ status: 'SUCCEEDED', dispatched: false });
    expect(res.message).toContain('SUCCEEDED');
    expect(scheduler.dispatchOne).not.toHaveBeenCalled();
  });

  it('does not re-run a FAILED window — it points at the explicit retry path', async () => {
    const prisma = buildPrisma();
    prisma.inferenceSchedule.findUnique.mockResolvedValue(schedule);
    prisma.modelVersion.findFirst.mockResolvedValue({ id: 'ver-1' });
    prisma.inferenceWindow.createMany.mockResolvedValue({ count: 0 });
    prisma.inferenceWindow.findUniqueOrThrow.mockResolvedValue({
      id: 'win-1',
      status: 'FAILED',
      windowStart: new Date('2026-09-17T04:00:00.000Z'),
      windowEnd: new Date('2026-09-17T05:00:00.000Z'),
    });
    const scheduler = buildScheduler();

    const res = await serviceWith(prisma, scheduler).runNowService(
      'model-1',
      user,
    );

    expect(res.message).toContain('retry');
    expect(scheduler.dispatchOne).not.toHaveBeenCalled();
  });

  it('always picks a FULLY ELAPSED window — never one ending in the future', async () => {
    const prisma = buildPrisma();
    prisma.inferenceSchedule.findUnique.mockResolvedValue({
      ...schedule,
      cadenceMinutes: 60,
      lagMinutes: 15,
    });
    prisma.modelVersion.findFirst.mockResolvedValue({ id: 'ver-1' });
    prisma.inferenceWindow.findUniqueOrThrow.mockResolvedValue({
      id: 'win-1',
      status: 'PENDING',
      windowStart: new Date('2026-09-17T04:00:00.000Z'),
      windowEnd: new Date('2026-09-17T05:00:00.000Z'),
    });
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-09-17T06:20:00.000Z').getTime());
    try {
      await serviceWith(prisma, buildScheduler()).runNowService(
        'model-1',
        user,
      );
      const insert = (
        prisma.inferenceWindow.createMany.mock.calls as unknown as [
          { data: { windowEnd: Date }[] },
        ][]
      )[0][0];
      // windowEnd is in the PAST by at least the configured lag — the
      // property MODEL-SERVE-006-T11 measured, restated as an assertion.
      expect(insert.data[0].windowEnd.getTime()).toBeLessThanOrEqual(
        Date.now() - 15 * 60_000,
      );
    } finally {
      jest.spyOn(Date, 'now').mockRestore();
    }
  });
});

/**
 * MODEL-SERVE-011-V01 (T08). The live half of Run Predict. The window plane
 * is already covered above; these cases exist to pin ONE property: the two
 * halves are independent, and neither can silently swallow the other.
 */
describe('InferenceWindowAuthorizedService.runNowService — live score (MODEL-SERVE-011-T08)', () => {
  const schedule = {
    modelId: 'model-1',
    enabled: true,
    cadenceMinutes: 60,
    lagMinutes: 0,
  };

  function readyPrisma() {
    const prisma = buildPrisma();
    prisma.inferenceSchedule.findUnique.mockResolvedValue(schedule);
    prisma.modelVersion.findFirst.mockResolvedValue({ id: 'ver-1' });
    prisma.inferenceWindow.findUniqueOrThrow.mockResolvedValue({
      id: 'win-1',
      status: 'PENDING',
      windowStart: new Date('2026-09-17T04:00:00.000Z'),
      windowEnd: new Date('2026-09-17T05:00:00.000Z'),
    });
    return prisma;
  }

  function serviceWith(
    prisma: ReturnType<typeof buildPrisma>,
    livePredict: ReturnType<typeof buildLivePredict>,
  ) {
    return makeService(
      prisma,
      buildDescriptor(),
      buildTruthSweeper(),
      buildMonitoring(),
      buildInputStatus(),
      buildScheduler(),
      livePredict,
    );
  }

  it('returns the predicted value and its row timestamp alongside the queued window', async () => {
    const live = buildLivePredict();
    const res = await serviceWith(readyPrisma(), live).runNowService(
      'model-1',
      user,
    );

    expect(res.statusCode).toBe(202);
    expect(res.data.live).toEqual({
      ok: true,
      predicted: 42.5,
      at: '2026-09-17T04:59:00.000Z',
    });
    expect(live.scoreOne).toHaveBeenCalledWith('model-1');
  });

  it('still queues the window when the live plane produced no point', async () => {
    const live = buildLivePredict({
      scoreOne: jest
        .fn()
        .mockResolvedValue({ ok: false, reason: 'Input not usable — TAG_A' }),
    });
    const res = await serviceWith(readyPrisma(), live).runNowService(
      'model-1',
      user,
    );

    // The window half is unaffected: a quiet source is a live-plane fact,
    // not a reason to withhold the run the operator asked for.
    expect(res.statusCode).toBe(202);
    expect(res.data.dispatched).toBe(true);
    expect(res.data.live).toMatchObject({ ok: false });
  });

  it('a THROWING live score cannot fail the request — the window is already queued', async () => {
    const live = buildLivePredict({
      scoreOne: jest.fn().mockRejectedValue(new Error('Serving unreachable')),
    });
    const res = await serviceWith(readyPrisma(), live).runNowService(
      'model-1',
      user,
    );

    expect(res.statusCode).toBe(202);
    expect(res.data.dispatched).toBe(true);
    // The server's OWN text, carried through rather than replaced by a
    // category — a serving outage and a bad input read differently.
    expect(res.data.live).toEqual({
      ok: false,
      reason: 'Serving unreachable',
    });
  });

  it('scores the live plane even when the latest window has already run', async () => {
    const prisma = readyPrisma();
    prisma.inferenceWindow.createMany.mockResolvedValue({ count: 0 });
    prisma.inferenceWindow.findUniqueOrThrow.mockResolvedValue({
      id: 'win-1',
      status: 'SUCCEEDED',
      windowStart: new Date('2026-09-17T04:00:00.000Z'),
      windowEnd: new Date('2026-09-17T05:00:00.000Z'),
    });
    const live = buildLivePredict();
    const res = await serviceWith(prisma, live).runNowService('model-1', user);

    // The window had nothing left to do; the operator still gets a fresh
    // reading, which is what the button is for on a model between windows.
    expect(res.statusCode).toBe(200);
    expect(res.data.dispatched).toBe(false);
    expect(res.data.live).toMatchObject({ ok: true, predicted: 42.5 });
  });
});

/** MODEL-SERVE-013. A persisted schedule row, with only the fields
 *  `getScheduleService` echoes — every one is non-null on the real row. */
const SCHEDULE_ROW = {
  enabled: true,
  cadenceMinutes: 60,
  lagMinutes: 5,
  sourceId: 'src-a',
  autoRetrain: false,
  warnSd: 1.5,
  criticalSd: 3.0,
  driftMonitor: false,
  missingPctWarn: 5,
  missingPctAlert: 20,
  skipStreakAlert: 3,
  frozenWindows: 3,
  frozenTolerancePct: 0,
};

/** One read, so each case below says what it asserts and nothing else. */
function service013(prisma: ReturnType<typeof buildPrisma>) {
  return makeService(prisma).getScheduleService('model-1', user);
}

/**
 * MODEL-SERVE-013. The data source a model actually fetches from: readable
 * by name on the settings surface, and changeable without starting the
 * model to do it.
 */
describe('InferenceWindowAuthorizedService.getScheduleService — data-source surface (MODEL-SERVE-013-T01)', () => {
  const SOURCES = [
    { id: 'src-a', name: 'PI North', type: 'aveva', status: 'connected' },
    { id: 'src-b', name: 'PI South', type: 'aveva', status: 'connected' },
  ];

  function buildSourcePrisma(overrides: Record<string, unknown> = {}) {
    return buildPrisma({
      modelVersion: {
        findFirst: jest.fn().mockResolvedValue({ sourceDatasetId: 'ds-1' }),
        findFirstOrThrow: jest.fn(),
      },
      dataset: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ sourceIds: ['src-a', 'src-b'] }),
      },
      dataSource: { findMany: jest.fn().mockResolvedValue(SOURCES) },
      ...overrides,
    });
  }

  it('resolves candidates off the PINNED version, never Model.datasetId', async () => {
    const prisma = buildSourcePrisma({
      inferenceSchedule: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...SCHEDULE_ROW, sourceId: 'src-a' }),
      },
    });
    const res = await service013(prisma);

    // D8: the dataset read is the PRODUCTION version's `sourceDatasetId`.
    // Reading `Model.datasetId` here would offer choices the write path
    // then refuses — live-verified those two ids can differ.
    expect(prisma.dataset.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ds-1' } }),
    );
    expect(res.data.sourceCandidates.map((s) => s.id)).toEqual([
      'src-a',
      'src-b',
    ]);
    expect(res.data.currentSource).toMatchObject({
      id: 'src-a',
      name: 'PI North',
    });
  });

  it('orders candidates by the dataset own sourceIds, not the DB order', async () => {
    const prisma = buildSourcePrisma({
      dataset: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ sourceIds: ['src-b', 'src-a'] }),
      },
      dataSource: { findMany: jest.fn().mockResolvedValue(SOURCES) },
    });
    const res = await service013(prisma);
    expect(res.data.sourceCandidates.map((s) => s.id)).toEqual([
      'src-b',
      'src-a',
    ]);
  });

  it('reports a bound source whose row is gone as missing, never as absent', async () => {
    // "This model fetches from something that no longer exists" is a fault
    // an operator repairs by relinking; collapsing it into null would hide
    // it behind the same rendering as "never deployed".
    const prisma = buildSourcePrisma({
      dataSource: { findMany: jest.fn().mockResolvedValue([]) },
      inferenceSchedule: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...SCHEDULE_ROW, sourceId: 'src-gone' }),
      },
    });
    const res = await service013(prisma);
    expect(res.data.currentSource).toEqual({
      id: 'src-gone',
      name: null,
      type: null,
      status: 'missing',
    });
  });

  it('a model with no schedule row still answers, with both keys present', async () => {
    // `InferenceSchedule.sourceId` is required, so no row means the model
    // was never bound at all — a state to render, never an error, and never
    // a response the client has to test for key presence on.
    const prisma = buildSourcePrisma();
    const res = await service013(prisma);
    expect(res.data.currentSource).toBeNull();
    expect(res.data.sourceCandidates).toHaveLength(2);
  });

  it('never throws when nothing is in production', async () => {
    const prisma = buildPrisma();
    const res = await service013(prisma);
    expect(res.statusCode).toBe(200);
    expect(res.data.sourceCandidates).toEqual([]);
    expect(res.data.currentSource).toBeNull();
  });
});

describe('InferenceWindowAuthorizedService.putScheduleService — relinking a STOPPED schedule (MODEL-SERVE-013-T02)', () => {
  const PIPELINE = {
    sourceFetchConfigs: {
      'src-a': { intervalTime: '1m' },
      'src-b': { intervalTime: '5m' },
    },
    baseTags: ['TAG.A'],
  };

  function buildRelinkPrisma(overrides: Record<string, unknown> = {}) {
    return buildPrisma({
      modelVersion: {
        findFirst: jest.fn().mockResolvedValue({ sourceDatasetId: 'ds-1' }),
        findFirstOrThrow: jest.fn(),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a', 'src-b'],
          pipelineConfig: PIPELINE,
        }),
      },
      inferenceSchedule: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ cadenceMinutes: 60 }),
      },
      ...overrides,
    });
  }

  it('persists the new source, its fetchConfig, and a RECOMPUTED minRows', async () => {
    const prisma = buildRelinkPrisma();
    const service = makeService(prisma);

    await service.putScheduleService(
      'model-1',
      { enabled: false, sourceId: 'src-b' },
      user,
    );

    const write = prisma.inferenceSchedule.updateMany.mock.calls[0][0];
    expect(write.data).toMatchObject({
      enabled: false,
      sourceId: 'src-b',
      fetchConfig: { intervalTime: '5m', baseTags: ['TAG.A'] },
    });
    // T14: minRows is DERIVED from the fetch config's own intervalTime, so
    // a new fetchConfig must bring a freshly derived floor with it — the
    // old number beside a new source is exactly the stale-derived state
    // that rule exists to prevent.
    expect(typeof write.data.minRows).toBe('number');
  });

  it('writes no preflight evidence — a stopped relink probed nothing', async () => {
    const prisma = buildRelinkPrisma();
    const inputStatus = buildInputStatus();
    const service = makeService(
      prisma,
      buildDescriptor(),
      buildTruthSweeper(),
      buildMonitoring(),
      inputStatus,
    );

    await service.putScheduleService(
      'model-1',
      { enabled: false, sourceId: 'src-b' },
      user,
    );

    expect(inputStatus.preflightSourceService).not.toHaveBeenCalled();
    const write = prisma.inferenceSchedule.updateMany.mock.calls[0][0];
    expect(write.data.preflightAt).toBeUndefined();
    expect(write.data.preflightOk).toBeUndefined();
    expect(write.data.preflightReason).toBeUndefined();
  });

  it('still cancels queued windows in the same transaction', async () => {
    const prisma = buildRelinkPrisma();
    const service = makeService(prisma);

    const res = await service.putScheduleService(
      'model-1',
      { enabled: false, sourceId: 'src-b' },
      user,
    );

    expect(prisma.inferenceWindow.updateMany).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('a plain stop writes ONLY enabled:false — no fallback binding', async () => {
    // The single-source fallback belongs to the enable path alone. A
    // request with no sourceId is not asking to change anything, and
    // silently binding "the only source" would turn every stop into a
    // write.
    const prisma = buildRelinkPrisma({
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: PIPELINE,
        }),
      },
    });
    const service = makeService(prisma);

    await service.putScheduleService('model-1', { enabled: false }, user);

    expect(prisma.inferenceSchedule.updateMany.mock.calls[0][0].data).toEqual({
      enabled: false,
    });
  });

  it('refuses a sourceId the pinned dataset does not name', async () => {
    const prisma = buildRelinkPrisma();
    const service = makeService(prisma);

    await expect(
      service.putScheduleService(
        'model-1',
        { enabled: false, sourceId: 'src-foreign' },
        user,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.inferenceSchedule.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a relink on a model with nothing in production', async () => {
    const prisma = buildRelinkPrisma({
      modelVersion: {
        findFirst: jest.fn().mockResolvedValue(null),
        findFirstOrThrow: jest.fn(),
      },
    });
    const service = makeService(prisma);

    await expect(
      service.putScheduleService(
        'model-1',
        { enabled: false, sourceId: 'src-b' },
        user,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('a model that was never deployed is left alone, not refused', async () => {
    // `updateMany` is a no-op without a row, so resolving a binding for a
    // model with no schedule would refuse a request that could not have
    // written anything anyway.
    const prisma = buildRelinkPrisma({
      inferenceSchedule: {
        upsert: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    });
    const service = makeService(prisma);

    const res = await service.putScheduleService(
      'model-1',
      { enabled: false, sourceId: 'src-b' },
      user,
    );

    expect(res.statusCode).toBe(200);
    expect(prisma.inferenceSchedule.updateMany.mock.calls[0][0].data).toEqual({
      enabled: false,
    });
  });
});
