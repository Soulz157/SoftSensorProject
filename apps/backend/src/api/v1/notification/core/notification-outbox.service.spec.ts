import { NotificationOutboxService } from './notification-outbox.service';

function buildTx(channels: unknown[], event: { id: string } = { id: 'evt-1' }) {
  return {
    notificationEvent: {
      upsert: jest.fn().mockResolvedValue(event),
    },
    notificationChannel: {
      findMany: jest.fn().mockResolvedValue(channels),
    },
    notificationDelivery: {
      createMany: jest.fn().mockResolvedValue({ count: channels.length }),
    },
  };
}

const baseParams = {
  workspaceId: 'ws-1',
  modelId: 'model-1',
  modelName: 'Reactor Temp',
  workspaceName: 'Plant A',
  axis: 'MONITORING' as const,
  event: 'MONITORING_ALERT',
  severity: 'CRITICAL' as const,
  title: 't',
  detail: 'd',
  at: new Date('2026-09-29T00:00:00.000Z'),
  eventKeySeed: 'ALERT:STALE:123',
};

describe('NotificationOutboxService.enqueueInTx (MODEL-SERVE-022-T03/T07)', () => {
  it('creates one delivery row per eligible channel returned by the query', async () => {
    const tx = buildTx([
      { id: 'ch-1', minSeverity: 'WARNING' },
      { id: 'ch-2', minSeverity: 'CRITICAL' },
    ]);
    const outbox = new NotificationOutboxService({} as never);
    await outbox.enqueueInTx(tx as never, baseParams);
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledTimes(1);
    const calls = tx.notificationDelivery.createMany.mock.calls as unknown[][];
    const call = calls[0][0] as { data: { channelId: string }[] };
    expect(call.data.map((r) => r.channelId)).toEqual(['ch-1', 'ch-2']);
  });

  it('writes the event but no deliveries when deliver is false (digest path)', async () => {
    const tx = buildTx([{ id: 'ch-1', minSeverity: 'INFO' }]);
    const outbox = new NotificationOutboxService({} as never);
    await outbox.enqueueInTx(tx as never, { ...baseParams, deliver: false });
    expect(tx.notificationEvent.upsert).toHaveBeenCalledTimes(1);
    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });

  it("drops a channel whose minSeverity is above this event's severity", async () => {
    const tx = buildTx([{ id: 'ch-1', minSeverity: 'CRITICAL' }]);
    const outbox = new NotificationOutboxService({} as never);
    await outbox.enqueueInTx(tx as never, {
      ...baseParams,
      severity: 'WARNING',
    });
    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });

  it('never writes a delivery when the workspace has no eligible channels', async () => {
    const tx = buildTx([]);
    const outbox = new NotificationOutboxService({} as never);
    await outbox.enqueueInTx(tx as never, baseParams);
    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });

  it('filters by event membership and the focus allow-list at the QUERY level', async () => {
    const tx = buildTx([{ id: 'ch-1', minSeverity: 'INFO' }]);
    const outbox = new NotificationOutboxService({} as never);
    await outbox.enqueueInTx(tx as never, baseParams);
    expect(tx.notificationChannel.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws-1',
        enabled: true,
        events: { has: 'MONITORING_ALERT' },
        focusModelIds: { has: 'model-1' },
      },
    });
  });

  it('uses the SAME eventKey for every matching channel (uniqueness is per-channel via the schema constraint)', async () => {
    const tx = buildTx([
      { id: 'ch-1', minSeverity: 'INFO' },
      { id: 'ch-2', minSeverity: 'INFO' },
    ]);
    const outbox = new NotificationOutboxService({} as never);
    await outbox.enqueueInTx(tx as never, baseParams);
    const calls = tx.notificationDelivery.createMany.mock.calls as unknown[][];
    const call = calls[0][0] as { data: { eventKey: string }[] };
    expect(call.data[0].eventKey).toBe(call.data[1].eventKey);
    expect(call.data[0].eventKey).toBe('model-1:MONITORING:ALERT:STALE:123');
  });

  // MODEL-SERVE-022-V07: one transition writes ONE NotificationEvent, and
  // the Teams delivery and the navbar feed both reference that same row —
  // a test checking each channel separately cannot tell one source from
  // two, so this asserts the SHARED eventId directly.
  it('V07: writes exactly one NotificationEvent, and every delivery row carries its id', async () => {
    const tx = buildTx(
      [
        { id: 'ch-1', minSeverity: 'INFO' },
        { id: 'ch-2', minSeverity: 'INFO' },
      ],
      { id: 'evt-shared' },
    );
    const outbox = new NotificationOutboxService({} as never);
    await outbox.enqueueInTx(tx as never, baseParams);

    expect(tx.notificationEvent.upsert).toHaveBeenCalledTimes(1);
    const upsertCalls = tx.notificationEvent.upsert.mock.calls as unknown[][];
    const upsertCall = upsertCalls[0][0] as {
      where: { dedupeKey: string };
      create: Record<string, unknown>;
    };
    expect(upsertCall.where.dedupeKey).toBe(
      'model-1:MONITORING:ALERT:STALE:123',
    );
    expect(upsertCall.create.workspaceId).toBe('ws-1');
    expect(upsertCall.create.modelId).toBe('model-1');

    const deliveryCalls = tx.notificationDelivery.createMany.mock
      .calls as unknown[][];
    const deliveryCall = deliveryCalls[0][0] as {
      data: { eventId: string }[];
    };
    expect(deliveryCall.data[0].eventId).toBe('evt-shared');
    expect(deliveryCall.data[1].eventId).toBe('evt-shared');
  });

  // V07 continued: the event is unconditional — it must exist even with
  // zero configured channels, since the in-app feed never depends on a
  // Teams/e-mail channel existing.
  it('V07: writes the NotificationEvent even when the workspace has zero channels', async () => {
    const tx = buildTx([]);
    const outbox = new NotificationOutboxService({} as never);
    await outbox.enqueueInTx(tx as never, baseParams);
    expect(tx.notificationEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('V07: a replayed enqueue never overwrites the original event (update: {})', async () => {
    const tx = buildTx([]);
    const outbox = new NotificationOutboxService({} as never);
    await outbox.enqueueInTx(tx as never, baseParams);
    const upsertCalls = tx.notificationEvent.upsert.mock.calls as unknown[][];
    const upsertCall = upsertCalls[0][0] as { update: Record<string, unknown> };
    expect(upsertCall.update).toEqual({});
  });

  it('passes fromStatus/toStatus/reason through onto the event create payload', async () => {
    const tx = buildTx([]);
    const outbox = new NotificationOutboxService({} as never);
    await outbox.enqueueInTx(tx as never, {
      ...baseParams,
      fromStatus: 'warning',
      toStatus: 'alert',
      reason: 'SOURCE_UNREACHABLE',
    });
    const upsertCalls = tx.notificationEvent.upsert.mock.calls as unknown[][];
    const upsertCall = upsertCalls[0][0] as {
      create: { fromStatus: string; toStatus: string; reason: string };
    };
    expect(upsertCall.create.fromStatus).toBe('warning');
    expect(upsertCall.create.toStatus).toBe('alert');
    expect(upsertCall.create.reason).toBe('SOURCE_UNREACHABLE');
  });
});

describe('NotificationOutboxService.enqueueDiscrete (best-effort)', () => {
  it('never throws when the transaction itself fails', async () => {
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const outbox = new NotificationOutboxService(prisma as never);
    await expect(outbox.enqueueDiscrete(baseParams)).resolves.toBeUndefined();
  });
});

describe('NotificationOutboxService.enqueueDigest (MODEL-SERVE-031)', () => {
  const digest = {
    workspaceName: 'Plant A',
    total: 3,
    alertCount: 0,
    warningCount: 0,
    frozenCount: 0,
    offlineCount: 0,
    rows: [],
    legend: {
      warn: 0.1,
      critical: 0.25,
      outOfRangeWarnPct: 5,
      outOfRangeCriticalPct: 20,
    },
    changes: [],
    longest: null,
  };

  it('writes one model-less delivery keyed per channel and sweep, with the table rows in the payload', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const outbox = new NotificationOutboxService({
      notificationDelivery: { createMany },
    } as never);
    await outbox.enqueueDigest({
      channelId: 'ch-1',
      workspaceId: 'ws-1',
      digest,
      severity: 'CRITICAL',
      at: new Date('2026-10-07T09:15:00.000Z'),
      eventKeySeed: '99',
    });
    const arg = (createMany.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>[];
      skipDuplicates: boolean;
    };
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data[0]).toMatchObject({
      channelId: 'ch-1',
      modelId: null,
      event: 'MONITORING_DIGEST',
      severity: 'CRITICAL',
      eventKey: 'digest:ws-1:99',
    });
    expect(arg.data[0].payload).toHaveProperty('digest');
  });

  it('never throws when the write fails', async () => {
    const outbox = new NotificationOutboxService({
      notificationDelivery: {
        createMany: jest.fn().mockRejectedValue(new Error('db down')),
      },
    } as never);
    await expect(
      outbox.enqueueDigest({
        channelId: 'ch-1',
        workspaceId: 'ws-1',
        digest,
        severity: 'INFO',
        at: new Date(),
        eventKeySeed: '1',
      }),
    ).resolves.toBeUndefined();
  });
});
