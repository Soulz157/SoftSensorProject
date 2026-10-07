import { InferenceWindowAuthorizedService } from '@/api/v1/inference-window/authorized/inference-window.authorized.service';
import { ModelRetrainAuthorizedService } from '@/api/v1/model-run/authorized/model-retrain.authorized.service';
import { ModelInputSchemaAuthorizedService } from '@/api/v1/model-version/authorized/model-input-schema.authorized.service';
import { ModelInputStatusAuthorizedService } from '@/api/v1/model-version/authorized/model-input-status.authorized.service';
import { ModelVersionAuthorizedService } from '@/api/v1/model-version/authorized/model-version.authorized.service';
import { PredictionLogAuthorizedService } from '@/api/v1/prediction-log/authorized/prediction-log.authorized.service';

jest.mock('@/lib/python-preprocess-client');
jest.mock('@/lib/python-client', () => ({
  postToPython: jest.fn(() => Promise.reject(new Error(PAST_GATE))),
  PYTHON_TIMEOUT: {},
}));

/**
 * Route wiring for the MONITORING_VIEW grant (2026-10-07). The rule itself
 * is covered in `workspace-permission.spec.ts`; this proves each service
 * passes 'monitoring-read' from its READ routes only. A granted VIEWER must
 * get past the access gate on every read and still be 403'd on every write.
 *
 * Past the gate, every dependency throws PAST_GATE — so "not a 403" means the
 * access check admitted the caller, whatever the route does next.
 */
const PAST_GATE = 'past-the-access-gate';

const user = { id: 'viewer-1', role: 'USER' } as unknown as Auth.UserPayload;

/** Any property is a callable that rejects with PAST_GATE (sync throw for
 *  non-async callers). `then` stays undefined so the proxy is not a thenable. */
function throwingDep(): unknown {
  const fail = () => {
    throw new Error(PAST_GATE);
  };
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === 'then'
          ? undefined
          : new Proxy(fail, { get: () => fail, apply: fail }),
    },
  );
}

function prismaFor(permissions: string[]) {
  const gate = {
    model: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'model-1', workspaceId: 'ws-1' }),
    },
    workspace: { findFirst: jest.fn().mockResolvedValue(null) },
    workspaceMember: {
      findFirst: jest.fn().mockResolvedValue({ role: 'VIEWER', permissions }),
    },
  };
  // The gate's three reads answer; anything after them is "past the gate".
  return new Proxy(gate, {
    get: (target, prop) =>
      prop in target
        ? new Proxy(target[prop as keyof typeof gate], {
            get: (delegate, method) =>
              method in delegate
                ? delegate[method as keyof typeof delegate]
                : () => Promise.reject(new Error(PAST_GATE)),
          })
        : prop === 'then'
          ? undefined
          : (throwingDep() as Record<string, unknown>)[prop as string],
  });
}

type Route = [name: string, call: (prisma: unknown) => Promise<unknown>];

const dep = () => throwingDep() as never;

const versions = (p: unknown) =>
  new ModelVersionAuthorizedService(p as never, dep());
const schema = (p: unknown) =>
  new ModelInputSchemaAuthorizedService(p as never);
const status = (p: unknown) =>
  new ModelInputStatusAuthorizedService(p as never, dep());
const windows = (p: unknown) =>
  new InferenceWindowAuthorizedService(
    p as never,
    dep(),
    dep(),
    dep(),
    dep(),
    dep(),
    dep(),
    dep(),
  );
const predictions = (p: unknown) =>
  new PredictionLogAuthorizedService(p as never, dep());
const retrain = (p: unknown) =>
  new ModelRetrainAuthorizedService(p as never, dep(), dep());

const range = {} as never;

const READ_ROUTES: Route[] = [
  ['listVersions', (p) => versions(p).listVersionsService(user, 'model-1')],
  ['getInputSchema', (p) => schema(p).getInputSchemaService('model-1', user)],
  ['getInputStatus', (p) => status(p).getInputStatusService('model-1', user)],
  ['getSchedule', (p) => windows(p).getScheduleService('model-1', user)],
  ['listWindows', (p) => windows(p).listWindowsService('model-1', {}, user)],
  ['getStatus', (p) => windows(p).getStatusService('model-1', user)],
  ['listLogs', (p) => windows(p).listLogsService('model-1', 'w-1', user)],
  [
    'getScheduledSeries',
    (p) => windows(p).getScheduledSeriesService('model-1', range, user),
  ],
  ['getTruth', (p) => windows(p).getTruthService('model-1', range, user)],
  [
    'getTagObservations',
    (p) => windows(p).getTagObservationsService('model-1', user),
  ],
  [
    'getPredictionSeries',
    (p) => predictions(p).getPredictionSeriesService('model-1', range, user),
  ],
  ['getPsi', (p) => predictions(p).getPsiService('model-1', range, user)],
  [
    'getCurrentRetrainJob',
    (p) => retrain(p).getCurrentRetrainJobService('model-1', user),
  ],
  [
    'getRetrainJob',
    (p) => retrain(p).getRetrainJobService('model-1', 'j-1', user),
  ],
];

const EDIT_ROUTES: Route[] = [
  [
    'promoteVersion',
    (p) => versions(p).promoteVersionService(user, 'model-1', 1, {}),
  ],
  [
    'removeVersion',
    (p) => versions(p).removeVersionService(user, 'model-1', 1),
  ],
  [
    'renameVersion',
    (p) => versions(p).renameVersionService(user, 'model-1', 1, { name: 'x' }),
  ],
  ['rollback', (p) => versions(p).rollbackService(user, 'model-1', {})],
  [
    'putSchedule',
    (p) => windows(p).putScheduleService('model-1', {} as never, user),
  ],
  ['backfill', (p) => windows(p).backfillService('model-1', {} as never, user)],
  ['runNow', (p) => windows(p).runNowService('model-1', user)],
  ['retry', (p) => windows(p).retryService('model-1', 'w-1', user)],
  [
    'rejoinTruth',
    (p) => windows(p).rejoinTruthService('model-1', {} as never, user),
  ],
  [
    'triggerRetrain',
    (p) => retrain(p).triggerRetrainService('model-1', {} as never, user),
  ],
  [
    'resolveTuningSize',
    (p) => retrain(p).resolveTuningSizeService('model-1', 'xgboost', user),
  ],
];

async function outcome(call: () => Promise<unknown>) {
  try {
    await call();
    return { statusCode: 200, message: 'resolved' };
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    return { statusCode: e.statusCode ?? 0, message: e.message ?? '' };
  }
}

describe('MONITORING_VIEW grant — route wiring', () => {
  describe('VIEWER with MONITORING_VIEW', () => {
    it.each(READ_ROUTES)('%s admits them past the gate', async (_n, call) => {
      const result = await outcome(() => call(prismaFor(['MONITORING_VIEW'])));
      expect(result.statusCode).not.toBe(403);
    });

    it.each(EDIT_ROUTES)('%s still refuses them with 403', async (_n, call) => {
      const result = await outcome(() =>
        call(prismaFor(['MONITORING_VIEW', 'NOTIFICATIONS_VIEW'])),
      );
      expect(result).toEqual({
        statusCode: 403,
        message: 'Forbidden: editor access required',
      });
    });
  });

  describe('VIEWER without the grant', () => {
    it.each(READ_ROUTES)('%s refuses them with 403', async (_n, call) => {
      const result = await outcome(() =>
        call(prismaFor(['NOTIFICATIONS_VIEW'])),
      );
      expect(result).toEqual({
        statusCode: 403,
        message: 'Forbidden: monitoring access required',
      });
    });
  });
});
