import {
  classifyDeployStatus,
  deriveDeployStatuses,
  isStale,
  overlayDeployStatus,
} from './deploy-status';
import { resolveColumnBaseline } from '@/lib/artifact-baseline';

// MODEL-SERVE-001-T30. `deriveDeployStatuses` now calls `resolveColumnBaseline`
// (an HTTP round trip to apps/python, in the real implementation) whenever an
// enabled schedule has a production version AND a window carrying
// `featureStats`. Mocked here so a fixture that reaches that branch cannot
// make a real network call during this suite — every OTHER existing test in
// this file has empty `inferenceWindow.findMany`/`modelVersion.findMany`
// fixtures and never reaches it at all.
jest.mock('@/lib/artifact-baseline');
const mockedResolveColumnBaseline = resolveColumnBaseline as jest.Mock;

describe('classifyDeployStatus (MODEL-SERVE-006-T12, reshaped by T26)', () => {
  it('is stopped when the schedule is not enabled, regardless of history', () => {
    expect(
      classifyDeployStatus({
        enabled: false,
        hasEverSucceeded: true,
        preflightOk: true,
      }),
    ).toBe('stopped');
  });

  it('is running when enabled and preflight passed', () => {
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: true,
        preflightOk: true,
      }),
    ).toBe('running');
  });

  it('is running from the press — a probed schedule does not sit in initializing', () => {
    // The operator has already been told the source answers; making them
    // watch a spinner until the first window lands would report an
    // uncertainty the system no longer has.
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: false,
        preflightOk: true,
      }),
    ).toBe('running');
  });

  it('is error when preflight FAILED — the only remaining path to error', () => {
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: false,
        preflightOk: false,
      }),
    ).toBe('error');
  });

  it('is initializing when NOT PROBED and nothing has been produced yet', () => {
    // A non-PI source, or a schedule enabled before T25 shipped.
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: false,
        preflightOk: null,
      }),
    ).toBe('initializing');
  });

  it('a NOT-PROBED schedule that has produced is running, not initializing', () => {
    // This is the case that carries every pre-T25 schedule across the
    // migration: never probed, but demonstrably working. A `null` read as a
    // failure here would flip every live schedule to Failed on deploy day.
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: true,
        preflightOk: null,
      }),
    ).toBe('running');
  });

  it('is stopped even when preflight failed — a disabled schedule is not an alarm', () => {
    expect(
      classifyDeployStatus({
        enabled: false,
        hasEverSucceeded: false,
        preflightOk: false,
      }),
    ).toBe('stopped');
  });
});

/**
 * T11. The scheduler now dispatches a window only once `windowStart +
 * cadence + lag <= now` (the scheduler's own T11 fix) — so that interval is
 * PROCESSING TIME, not lateness, and must not count against
 * INFERENCE_STALE_AFTER_CADENCES (default 3). Boundary math below at
 * cadence=60/lag=15: allowance is 3*60=180min beyond `windowStart + 75min`.
 *
 * Not "headroom unchanged": the old inline calc measured staleness purely
 * from `lastSucceeded.windowStart`, giving 180min of raw allowance from
 * windowStart. The fix's own 75min processing offset makes the EFFECTIVE
 * headroom wider (255min from windowStart), not narrower — asserted here as
 * `isStale`'s own boundary, not as a before/after comparison.
 */
describe('isStale (MODEL-SERVE-001-T11)', () => {
  const NOW = new Date('2026-09-14T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is STALE, unconditionally, when nothing has ever succeeded', () => {
    expect(isStale(null, 60, 15)).toBe('STALE');
  });

  it('is OK exactly AT the boundary (windowStart + cadence + lag + STALE*cadence)', () => {
    // processableAt = 07:45 + 75min = 09:00; now(12:00) - 09:00 = 180min,
    // the exact allowance (3 * 60min) — NOT strictly greater, so OK.
    const lastWindowStart = new Date('2026-09-14T07:45:00.000Z');
    expect(isStale(lastWindowStart, 60, 15)).toBe('OK');
  });

  it('is STALE one minute past that same boundary', () => {
    const lastWindowStart = new Date('2026-09-14T07:44:00.000Z');
    expect(isStale(lastWindowStart, 60, 15)).toBe('STALE');
  });

  it('does not count the cadence+lag processing interval itself as staleness', () => {
    // A window that became processable RIGHT NOW (the freshest possible
    // reading) must never read STALE regardless of cadence/lag size.
    const lastWindowStart = new Date(NOW.getTime() - (60 + 15) * 60_000);
    expect(isStale(lastWindowStart, 60, 15)).toBe('OK');
  });
});

describe('overlayDeployStatus', () => {
  it('merges deployStatus AND enabled into existing data without mutating the input', () => {
    const model = { id: 'm1', data: { prodStatus: 'normal' } };
    const result = overlayDeployStatus(model, {
      status: 'running',
      enabled: true,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
    expect(result.data).toEqual({
      prodStatus: 'normal',
      deployStatus: 'running',
      enabled: true,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
    expect(model.data).toEqual({ prodStatus: 'normal' }); // unchanged
  });

  it('handles a null/non-object data field defensively', () => {
    const model = { id: 'm1', data: null };
    expect(
      overlayDeployStatus(model, {
        status: 'stopped',
        enabled: false,
        lastFailure: null,
        monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
      }).data,
    ).toEqual({
      deployStatus: 'stopped',
      enabled: false,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });

  // MODEL-SERVE-001-T23.
  it('carries a real failure reason through onto the list payload', () => {
    const at = new Date('2026-09-15T10:00:00.000Z');
    const model = { id: 'm1', data: {} };
    const result = overlayDeployStatus(model, {
      status: 'error',
      enabled: true,
      lastFailure: { reason: 'Materialize failed: source unreachable', at },
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
    expect(result.data).toEqual({
      deployStatus: 'error',
      enabled: true,
      lastFailure: { reason: 'Materialize failed: source unreachable', at },
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });

  /**
   * MODEL-SERVE-001-T19. The exact case the fix exists for: a schedule the
   * operator has enabled but which is failing reads status 'error' while
   * `enabled` stays true — a Start/Stop control reading `enabled` (not
   * `status`) is what lets it offer Stop here.
   */
  it('carries enabled=true alongside an error status — the enabled-but-failing case', () => {
    const model = { id: 'm1', data: {} };
    const result = overlayDeployStatus(model, {
      status: 'error',
      enabled: true,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
    expect(result.data).toEqual({
      deployStatus: 'error',
      enabled: true,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });
});

describe('deriveDeployStatuses (batched)', () => {
  function buildPrisma(overrides: Record<string, unknown> = {}) {
    return {
      inferenceSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      inferenceWindow: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // MODEL-SERVE-012-T08. The output-error axis's two batched reads.
      // Present by default and EMPTY, so every pre-existing case here keeps
      // asserting the deploy verdict it was written for: no production
      // version and no joined pairs both mean UNKNOWN, which this axis
      // defines as silent.
      modelVersion: { findMany: jest.fn().mockResolvedValue([]) },
      inferenceWindowTruth: { groupBy: jest.fn().mockResolvedValue([]) },
      ...overrides,
    } as unknown as Parameters<typeof deriveDeployStatuses>[0];
  }

  it('returns stopped/disabled for every id when nothing has a schedule', async () => {
    const prisma = buildPrisma();
    const result = await deriveDeployStatuses(prisma, ['m1', 'm2']);
    expect(result).toEqual({
      m1: {
        status: 'stopped',
        enabled: false,
        lastFailure: null,
        monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
      },
      m2: {
        status: 'stopped',
        enabled: false,
        lastFailure: null,
        monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
      },
    });
  });

  /**
   * MODEL-SERVE-001-V22. THE NO-N+1 BOUND, which is what lets the Alerts page
   * stay a pure function over the models list instead of one status request
   * per model.
   *
   * The shape is deliberately asserted as it really is — **2 + E**, E being
   * the number of ENABLED schedules — not as the "fully batched" the doc
   * comment on `deriveDeployStatuses` once implied. The two batched reads are
   * constant; the take-3 terminal-window read fans out over enabled models
   * only. Pinning the real figure is the point: a future change that adds one
   * more per-model read (a baseline fetch for drift, a featureStats select for
   * frozen) breaks this test rather than quietly tripling the list's cost.
   *
   * The fixture uses TWO ENABLED schedules on purpose. With everything
   * disabled the fan-out term is zero and the assertion passes at one query
   * while proving nothing at all — the exact vacuous-fixture trap this
   * feature has hit twice before.
   */
  it('runs 2 + (one per ENABLED schedule) queries for the list — no per-model fan-out beyond the terminal-window read', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            // Finite cadence/lag, NOT undefined: `isStale` fails toward
            // 'STALE' on a missing cadence, and three pre-existing fixtures
            // in this file were found passing `undefined` (see isStale's own
            // doc). A vague fixture would make this assert the wrong path.
            cadenceMinutes: 60,
            lagMinutes: 15,
            preflightOk: true,
            skipStreakAlert: 3,
            missingPctWarn: 5,
            missingPctAlert: 20,
            warnSd: 1.5,
            criticalSd: 3.0,
          },
          {
            modelId: 'm2',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            preflightOk: true,
            skipStreakAlert: 3,
            missingPctWarn: 5,
            missingPctAlert: 20,
            warnSd: 1.5,
            criticalSd: 3.0,
          },
          // Disabled: contributes NO terminal-window read. Present so the
          // count below distinguishes "per enabled schedule" from "per model".
          {
            modelId: 'm3',
            enabled: false,
            cadenceMinutes: 60,
            lagMinutes: 15,
            preflightOk: null,
            skipStreakAlert: 3,
            missingPctWarn: 5,
            missingPctAlert: 20,
            warnSd: 1.5,
            criticalSd: 3.0,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest.fn().mockResolvedValue([
          { modelId: 'm1', _max: { windowStart: new Date() } },
          { modelId: 'm2', _max: { windowStart: new Date() } },
        ]),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    await deriveDeployStatuses(prisma, ['m1', 'm2', 'm3']);

    const mock = prisma as unknown as {
      inferenceSchedule: { findMany: jest.Mock };
      inferenceWindow: { groupBy: jest.Mock; findMany: jest.Mock };
      modelVersion: { findMany: jest.Mock };
      inferenceWindowTruth: { groupBy: jest.Mock };
    };
    // Batched over every id, once.
    expect(mock.inferenceSchedule.findMany).toHaveBeenCalledTimes(1);
    // Batched over the enabled ids, once.
    expect(mock.inferenceWindow.groupBy).toHaveBeenCalledTimes(1);
    // TWO enabled schedules => two terminal-window reads. Three models, not
    // three reads: the disabled one costs nothing.
    expect(mock.inferenceWindow.findMany).toHaveBeenCalledTimes(2);
    // MODEL-SERVE-012-T08. THE OUTPUT-ERROR AXIS COSTS TWO QUERIES FOR THE
    // WHOLE PAGE, not two per model — the property that let it ride this
    // path at all while drift (an artifact round trip per model) could not.
    // Three models here, still one call each.
    expect(mock.modelVersion.findMany).toHaveBeenCalledTimes(1);
    // ZERO, not one: no model has a production version in this fixture, and
    // the aggregate is skipped entirely rather than sent with an empty `in`.
    expect(mock.inferenceWindowTruth.groupBy).toHaveBeenCalledTimes(0);
  });

  /**
   * MODEL-SERVE-012-T08. The same count with production versions present —
   * the case above proves the skip, this one proves the aggregate is ONE
   * query for every version rather than one per model.
   */
  it('pools truth rows for every production version in ONE aggregate', async () => {
    const schedule = (modelId: string) => ({
      modelId,
      enabled: true,
      cadenceMinutes: 60,
      lagMinutes: 15,
      preflightOk: true,
      skipStreakAlert: 3,
      missingPctWarn: 5,
      missingPctAlert: 20,
      warnSd: 1.5,
      criticalSd: 3.0,
    });
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([schedule('m1'), schedule('m2')]),
      },
      inferenceWindow: {
        groupBy: jest.fn().mockResolvedValue([
          { modelId: 'm1', _max: { windowStart: new Date() } },
          { modelId: 'm2', _max: { windowStart: new Date() } },
        ]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      modelVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'v1', modelId: 'm1', metrics: { sd: 2 } },
          { id: 'v2', modelId: 'm2', metrics: { sd: 2 } },
        ]),
      },
      inferenceWindowTruth: {
        groupBy: jest.fn().mockResolvedValue([
          {
            modelVersionId: 'v1',
            // 40 pairs whose residual SD is 8 -> ratio 4 against a
            // reference of 2, which is past criticalSd.
            _sum: {
              n: 40,
              sumSe: 40 * 64,
              sumAe: 40 * 8,
              sumSigned: 0,
              sumActual: 4000,
              sumActualSq: 401000,
            },
          },
        ]),
      },
    });

    const result = await deriveDeployStatuses(prisma, ['m1', 'm2']);

    const mock = prisma as unknown as {
      inferenceWindowTruth: { groupBy: jest.Mock };
    };
    expect(mock.inferenceWindowTruth.groupBy).toHaveBeenCalledTimes(1);
    // m1 has the pairs: the list now carries a REAL graded verdict, which is
    // the whole point of T08 — before it, this payload could only ever emit
    // OFF or a liveness ALERT.
    expect(result.m1.monitoring.status).toBe('ALERT');
    expect(result.m1.monitoring.reason).toBe('RESIDUAL_SD_CRITICAL');
    // m2 has a production version but NO joined pairs — UNKNOWN, never OK,
    // and so it stays OFF on this liveness-only payload.
    expect(result.m2.monitoring.status).toBe('OFF');
  });

  it('returns an empty object for an empty id list without querying', async () => {
    const prisma = buildPrisma();
    const result = await deriveDeployStatuses(prisma, []);
    expect(result).toEqual({});
    expect(
      (prisma as unknown as { inferenceSchedule: { findMany: jest.Mock } })
        .inferenceSchedule.findMany,
    ).not.toHaveBeenCalled();
  });

  it('derives running for an enabled schedule with a recent succeeded window', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            // Real rows always carry this column. Stated explicitly so a
            // reader cannot conclude it is optional — `undefined` would take
            // the same branch as `true` here and pass for the wrong reason.
            preflightOk: true,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', _max: { windowStart: new Date() } },
          ]),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { status: 'SUCCEEDED' },
            { status: 'SUCCEEDED' },
            { status: 'SUCCEEDED' },
          ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1).toEqual({
      status: 'running',
      enabled: true,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });

  /**
   * MODEL-SERVE-001-V19. RUNNING IS STICKY — proven on a fixture that HAS
   * ALREADY SUCCEEDED ONCE, which is the half of V19 that does the work.
   *
   * A never-succeeded fixture would pass under the OLD logic too and prove
   * nothing: that is the exact trap V10 recorded when TM2 could not
   * demonstrate T12's warmup change because it already held six failed
   * windows. Here `groupBy` returns a real last-SUCCEEDED window (the model
   * WAS producing), and only then do three consecutive FAILED windows
   * arrive.
   *
   * BEFORE T26 THIS CASE ASSERTED `status: 'error'`. That is the behaviour
   * change, stated rather than quietly rewritten: three failed windows say
   * something about the DATA, not about whether the scheduler is
   * dispatching, so they moved to the monitoring axis (ALERT/
   * SOURCE_UNREACHABLE — see model-health.spec.ts). `enabled` staying true
   * alongside it is still T19's Stop-control requirement, unchanged.
   */
  it('stays running through three consecutive failures on a model that has succeeded before', async () => {
    const failedWindows = [
      {
        status: 'FAILED',
        failureReason: 'spawn refused',
        windowStart: new Date('2026-09-15T12:00:00.000Z'),
      },
      {
        status: 'FAILED',
        failureReason: 'spawn refused',
        windowStart: new Date('2026-09-15T11:00:00.000Z'),
      },
      {
        status: 'FAILED',
        failureReason: 'spawn refused',
        windowStart: new Date('2026-09-15T10:00:00.000Z'),
      },
    ];

    // Snapshot the status after EACH failure, not only after the third:
    // "it ended up running" is compatible with it having flickered through
    // 'error' in between, which is what an operator would actually see.
    const statusAfter: string[] = [];
    for (let n = 1; n <= 3; n += 1) {
      const prisma = buildPrisma({
        inferenceSchedule: {
          findMany: jest.fn().mockResolvedValue([
            {
              modelId: 'm1',
              enabled: true,
              cadenceMinutes: 60,
              lagMinutes: 15,
              preflightOk: true,
            },
          ]),
        },
        inferenceWindow: {
          // It succeeded once, before any of the failures above.
          groupBy: jest
            .fn()
            .mockResolvedValue([
              { modelId: 'm1', _max: { windowStart: new Date() } },
            ]),
          findMany: jest.fn().mockResolvedValue(failedWindows.slice(3 - n)),
        },
      });
      const result = await deriveDeployStatuses(prisma, ['m1']);
      statusAfter.push(result.m1.status);
    }

    expect(statusAfter).toEqual(['running', 'running', 'running']);
  });

  it('still reports the failure reason while reading running — the fault is not hidden, just re-homed', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            preflightOk: true,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', _max: { windowStart: new Date() } },
          ]),
        findMany: jest.fn().mockResolvedValue([
          {
            status: 'FAILED',
            failureReason: 'spawn refused',
            windowStart: new Date('2026-09-15T12:00:00.000Z'),
          },
        ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1).toEqual({
      status: 'running',
      enabled: true,
      lastFailure: {
        reason: 'spawn refused',
        at: new Date('2026-09-15T12:00:00.000Z'),
      },
      // ONE failure, below the 3-window bar — a fault is reported, not yet
      // alarmed. The deploy axis is unmoved either way.
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });

  it('derives initializing for a just-enabled, NOT-PROBED schedule with no windows yet', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            // T25/T26: not probed (a non-PI source, or enabled before T25).
            // A PROBED schedule is running from the press instead.
            preflightOk: null,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest.fn().mockResolvedValue([]), // no SUCCEEDED/SKIPPED window yet
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1).toEqual({
      status: 'initializing',
      enabled: true,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });

  it('derives error for a schedule whose enable-time preflight failed', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            preflightOk: false,
          },
        ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1?.status).toBe('error');
    // T19's Stop-control requirement survives the reshape.
    expect(result.m1?.enabled).toBe(true);
  });

  it('derives disabled/stopped for a schedule the operator turned off, even mid-failure', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: false,
            cadenceMinutes: 60,
            lagMinutes: 15,
            preflightOk: true,
          },
        ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1).toEqual({
      status: 'stopped',
      enabled: false,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });

  /**
   * MODEL-SERVE-001-T23. The reason the Alerts page can show a real failure
   * cause without a per-model request: it rides on the recent-terminal
   * query this function already makes. Redaction is asserted here rather
   * than trusted, because this column holds the infer container's verbatim
   * `str(err)` — the one failureReason writer never sanitized on the way in.
   */
  it('returns the most recent FAILED window reason, redacted', async () => {
    const newest = new Date('2026-09-15T12:00:00.000Z');
    const older = new Date('2026-09-15T11:00:00.000Z');
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            // Real rows always carry this column. Stated explicitly so a
            // reader cannot conclude it is optional — `undefined` would take
            // the same branch as `true` here and pass for the wrong reason.
            preflightOk: true,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest.fn().mockResolvedValue([]),
        // DESC by windowStart, as the real query orders it.
        findMany: jest.fn().mockResolvedValue([
          {
            status: 'FAILED',
            failureReason: 'Materialize failed: http://pi.internal/x timed out',
            windowStart: newest,
          },
          {
            status: 'FAILED',
            failureReason: 'an older failure',
            windowStart: older,
          },
        ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1?.lastFailure?.at).toEqual(newest);
    expect(result.m1?.lastFailure?.reason).not.toContain('pi.internal');
    expect(result.m1?.lastFailure?.reason).toContain('Materialize failed');
  });

  it('reports lastFailure null when the recent-terminal sample holds no FAILED row', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            // Real rows always carry this column. Stated explicitly so a
            // reader cannot conclude it is optional — `undefined` would take
            // the same branch as `true` here and pass for the wrong reason.
            preflightOk: true,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', _max: { windowStart: new Date() } },
          ]),
        findMany: jest.fn().mockResolvedValue([
          { status: 'SUCCEEDED', failureReason: null, windowStart: new Date() },
          {
            status: 'SKIPPED',
            failureReason: 'below minRows',
            windowStart: new Date(),
          },
        ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    // A SKIPPED window carries a failureReason too, and it is NOT an error —
    // the same distinction getStatusService's lastFailure/lastSkipped split
    // already draws. It must not leak into this field.
    expect(result.m1?.lastFailure).toBeNull();
  });
});

/**
 * MODEL-SERVE-001-T30. Frozen detection on the LIST path, wired into the
 * SAME per-model window read `lastFailure` already used — see that
 * describe block's own query-count test for why this does not add a new
 * query beyond widening the existing one.
 *
 * `resolveColumnBaseline` is mocked at the top of this file; every fixture
 * below sets `featureStats` EXPLICITLY (never omits it) on every window,
 * because `null` — not "the field happens to be absent" — is what the real
 * Prisma client always returns for a JSON column with no value, and the
 * production filter (`s !== null`) relies on exactly that guarantee.
 */
describe('deriveDeployStatuses — frozen detection (MODEL-SERVE-001-T30)', () => {
  // `mockedResolveColumnBaseline` is declared ONCE at module scope (the
  // `jest.mock` above), unlike `prisma`, which every test rebuilds fresh via
  // `buildPrisma()` — so its call history survives between `it()` blocks
  // unless cleared here.
  afterEach(() => {
    mockedResolveColumnBaseline.mockClear();
  });

  function buildPrisma(overrides: Record<string, unknown> = {}) {
    return {
      inferenceSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      inferenceWindow: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      modelVersion: { findMany: jest.fn().mockResolvedValue([]) },
      inferenceWindowTruth: { groupBy: jest.fn().mockResolvedValue([]) },
      ...overrides,
    } as unknown as Parameters<typeof deriveDeployStatuses>[0];
  }

  const SCHEDULE = {
    modelId: 'm1',
    enabled: true,
    cadenceMinutes: 60,
    lagMinutes: 15,
    preflightOk: true,
    skipStreakAlert: 3,
    missingPctWarn: 5,
    missingPctAlert: 20,
    warnSd: 1.5,
    criticalSd: 3.0,
    frozenWindows: 3,
    frozenTolerancePct: 0,
  };

  const PRODUCTION_VERSION = {
    id: 'v1',
    modelId: 'm1',
    metrics: null,
    goldObjectKey: 'models/m1/versions/v1/gold/data.parquet',
  };

  const BASELINE = {
    tag_a: { mean: 10, std: 2, percentiles: { p1: 4, p99: 16 } },
  };

  it('reports the same FROZEN verdict the single-model path would, from windows this batched query already fetches', async () => {
    mockedResolveColumnBaseline.mockResolvedValue(BASELINE);
    // Flat across all three windows: min === max === 12. The baseline's own
    // std is 2 (not near-zero), so guard (1) — "already flat in training" —
    // does not skip it. Mirrors sensor-frozen.spec.ts's own fixture.
    const FLAT = {
      status: 'SUCCEEDED',
      failureReason: null,
      windowStart: new Date(),
      featureStats: {
        tag_a: { n: 10, sum: 120, sumsq: 1440, min: 12, max: 12 },
      },
    };
    const prisma = buildPrisma({
      inferenceSchedule: { findMany: jest.fn().mockResolvedValue([SCHEDULE]) },
      inferenceWindow: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', _max: { windowStart: new Date() } },
          ]),
        findMany: jest.fn().mockResolvedValue([FLAT, FLAT, FLAT]),
      },
      modelVersion: {
        findMany: jest.fn().mockResolvedValue([PRODUCTION_VERSION]),
      },
    });

    const result = await deriveDeployStatuses(prisma, ['m1']);

    expect(mockedResolveColumnBaseline).toHaveBeenCalledWith(
      'models/m1/versions/v1/gold/data.parquet',
    );
    expect(result.m1?.monitoring.status).toBe('FROZEN');
    expect(result.m1?.monitoring.reason).toBe('SENSOR_FROZEN');
    expect(result.m1?.monitoring.frozenColumns).toEqual(['tag_a']);
  });

  it('never calls resolveColumnBaseline when the model has no production version', async () => {
    const FLAT = {
      status: 'SUCCEEDED',
      failureReason: null,
      windowStart: new Date(),
      featureStats: {
        tag_a: { n: 10, sum: 120, sumsq: 1440, min: 12, max: 12 },
      },
    };
    const prisma = buildPrisma({
      inferenceSchedule: { findMany: jest.fn().mockResolvedValue([SCHEDULE]) },
      inferenceWindow: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', _max: { windowStart: new Date() } },
          ]),
        findMany: jest.fn().mockResolvedValue([FLAT, FLAT, FLAT]),
      },
      // Default modelVersion.findMany: [] — no production version.
    });

    const result = await deriveDeployStatuses(prisma, ['m1']);

    expect(mockedResolveColumnBaseline).not.toHaveBeenCalled();
    expect(result.m1?.monitoring.frozenColumns).toEqual([]);
  });

  it('never calls resolveColumnBaseline when no window in the sample carries featureStats', async () => {
    const NO_STATS = {
      status: 'SUCCEEDED',
      failureReason: null,
      windowStart: new Date(),
      featureStats: null,
    };
    const prisma = buildPrisma({
      inferenceSchedule: { findMany: jest.fn().mockResolvedValue([SCHEDULE]) },
      inferenceWindow: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', _max: { windowStart: new Date() } },
          ]),
        findMany: jest.fn().mockResolvedValue([NO_STATS, NO_STATS, NO_STATS]),
      },
      modelVersion: {
        findMany: jest.fn().mockResolvedValue([PRODUCTION_VERSION]),
      },
    });

    const result = await deriveDeployStatuses(prisma, ['m1']);

    expect(mockedResolveColumnBaseline).not.toHaveBeenCalled();
    expect(result.m1?.monitoring.frozenColumns).toEqual([]);
  });

  it('calls resolveColumnBaseline but reports no frozen columns when the tag is genuinely moving', async () => {
    mockedResolveColumnBaseline.mockResolvedValue(BASELINE);
    const windows = [
      {
        status: 'SUCCEEDED',
        failureReason: null,
        windowStart: new Date(),
        featureStats: {
          tag_a: { n: 10, sum: 100, sumsq: 1005, min: 9, max: 11 },
        },
      },
      {
        status: 'SUCCEEDED',
        failureReason: null,
        windowStart: new Date(),
        featureStats: {
          tag_a: { n: 10, sum: 110, sumsq: 1220, min: 10, max: 12 },
        },
      },
      {
        status: 'SUCCEEDED',
        failureReason: null,
        windowStart: new Date(),
        featureStats: {
          tag_a: { n: 10, sum: 90, sumsq: 815, min: 8, max: 10 },
        },
      },
    ];
    const prisma = buildPrisma({
      inferenceSchedule: { findMany: jest.fn().mockResolvedValue([SCHEDULE]) },
      inferenceWindow: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', _max: { windowStart: new Date() } },
          ]),
        findMany: jest.fn().mockResolvedValue(windows),
      },
      modelVersion: {
        findMany: jest.fn().mockResolvedValue([PRODUCTION_VERSION]),
      },
    });

    const result = await deriveDeployStatuses(prisma, ['m1']);

    expect(mockedResolveColumnBaseline).toHaveBeenCalled();
    expect(result.m1?.monitoring.frozenColumns).toEqual([]);
    expect(result.m1?.monitoring.status).not.toBe('FROZEN');
  });

  it("widens take to the schedule's own frozenWindows, not a flat 3", async () => {
    mockedResolveColumnBaseline.mockResolvedValue(BASELINE);
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...SCHEDULE, frozenWindows: 10 }]),
      },
      inferenceWindow: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', _max: { windowStart: new Date() } },
          ]),
        findMany,
      },
      modelVersion: {
        findMany: jest.fn().mockResolvedValue([PRODUCTION_VERSION]),
      },
    });

    await deriveDeployStatuses(prisma, ['m1']);

    // A fixed 3 against an operator-set 10 could never gather enough
    // evidence to badge anything — the exact "settings that appear to work
    // and may do nothing" defect T21's audit found, now on the list path.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });
});
