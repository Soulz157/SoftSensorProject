import { NotificationEvaluatorService } from './notification-evaluator.service';

jest.mock('@/lib/deploy-status', () => ({
  deriveDeployStatuses: jest.fn().mockResolvedValue({}),
}));

const health = (status: string, reason: string | null) => ({
  status,
  reason,
  frozenColumns: [],
  frozenSince: [],
  thresholds: { warnSd: 1.5, criticalSd: 3 },
  residualSd: {
    status: 'UNKNOWN',
    liveSd: null,
    ratio: null,
    baselineSd: null,
    n: 0,
  },
  psiSummary: { worstColumn: 'FI-1', worstPsi: 0.31, maxOutOfRangePct: 24 },
});

function build(opts: {
  prevStatus: string | null;
  next: ReturnType<typeof health>;
  channels: unknown[];
}) {
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = {
    inferenceSchedule: {
      findMany: jest.fn().mockResolvedValue([{ modelId: 'm1' }]),
    },
    modelAlertState: {
      findMany: jest
        .fn()
        // selectCandidates, then sendDigests' persisted-state read.
        .mockResolvedValueOnce([])
        .mockResolvedValue([
          {
            modelId: 'm1',
            status: opts.next.status,
            reason: opts.next.reason,
            frozenColumns: [],
            metrics: {
              worstPsiColumn: 'FI-1',
              worstPsi: 0.31,
              maxOutOfRangePct: 24,
              sdRatio: null,
              warnSd: 1.5,
              criticalSd: 3,
            },
            model: { name: 'TS-101' },
          },
        ]),
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.prevStatus
            ? { status: opts.prevStatus, reason: null, frozenColumns: [] }
            : null,
        ),
      upsert,
    },
    model: {
      findUnique: jest.fn().mockResolvedValue({
        name: 'TS-101',
        workspace: { id: 'ws-1', name: 'ROC Plant' },
      }),
    },
    notificationChannel: {
      findMany: jest.fn().mockResolvedValue(opts.channels),
    },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ modelAlertState: { upsert } }),
    ),
  };
  const monitoring = {
    getHealthStatus: jest.fn().mockResolvedValue(opts.next),
  };
  const outbox = {
    enqueueInTx: jest.fn().mockResolvedValue(undefined),
    enqueueDigest: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new NotificationEvaluatorService(
    prisma as never,
    monitoring as never,
    outbox as never,
  );
  return { svc, outbox, upsert };
}

const channel = (over: Record<string, unknown>) => ({
  id: 'ch',
  minSeverity: 'WARNING',
  events: ['MONITORING_ALERT', 'MONITORING_WARNING'],
  focusModelIds: ['m1'],
  ...over,
});

describe('NotificationEvaluatorService digest (MODEL-SERVE-031)', () => {
  it('sends one digest per channel that passes its own filters, and none to the rest', async () => {
    const { svc, outbox } = build({
      prevStatus: 'WARN',
      next: health('ALERT', 'DRIFT_CRITICAL'),
      channels: [
        channel({ id: 'ok' }),
        channel({ id: 'other-focus', focusModelIds: ['zzz'] }),
        channel({ id: 'not-subscribed', events: ['MODEL_STARTED'] }),
      ],
    });
    await svc.sweep();
    const calls = outbox.enqueueDigest.mock.calls as unknown[][];
    expect(calls.map((c) => (c[0] as { channelId: string }).channelId)).toEqual(
      ['ok'],
    );
    const arg = calls[0][0] as {
      severity: string;
      digest: { total: number; alertCount: number; rows: unknown[] };
    };
    expect(arg.severity).toBe('CRITICAL');
    expect(arg.digest).toMatchObject({ total: 1, alertCount: 1 });
    expect(arg.digest.rows).toHaveLength(1);
  });

  it('applies the channel minSeverity floor', async () => {
    const { svc, outbox } = build({
      prevStatus: 'OK',
      next: health('WARN', 'DRIFT_WARN'),
      channels: [channel({ minSeverity: 'CRITICAL' })],
    });
    await svc.sweep();
    expect(outbox.enqueueDigest).not.toHaveBeenCalled();
  });

  it('keeps the per-model event but skips its per-model delivery', async () => {
    const { svc, outbox } = build({
      prevStatus: 'WARN',
      next: health('ALERT', 'DRIFT_CRITICAL'),
      channels: [channel({})],
    });
    await svc.sweep();
    const params = (outbox.enqueueInTx.mock.calls as unknown[][])[0][1] as {
      deliver: boolean;
    };
    expect(params.deliver).toBe(false);
  });

  it('refreshes metrics every pass but sends nothing when status is unchanged', async () => {
    const { svc, outbox, upsert } = build({
      prevStatus: 'ALERT',
      next: health('ALERT', null),
      channels: [channel({})],
    });
    await svc.sweep();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(outbox.enqueueDigest).not.toHaveBeenCalled();
  });
});
