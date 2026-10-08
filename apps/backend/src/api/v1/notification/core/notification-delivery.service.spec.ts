import { NotificationDeliveryService } from './notification-delivery.service';

const payload = {
  title: 'Test',
  bodyText: 'body',
  modelUrl: 'https://app.local/models/m-1',
};

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    notificationDelivery: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

function buildMailer(sendMail = jest.fn().mockResolvedValue(undefined)) {
  return { sendMail };
}

const emailChannel = {
  id: 'ch-1',
  kind: 'EMAIL',
  encryptedTarget: null,
  recipientUserIds: ['u-1'],
};

const teamsChannel = {
  id: 'ch-2',
  kind: 'TEAMS_WORKFLOW',
  // A real encryptSecret() output isn't needed since these tests stub
  // failure/success at the fetch boundary, never actually decrypting it.
  encryptedTarget: 'v1:AAAA:BBBB:CCCC',
  recipientUserIds: [],
};

describe('NotificationDeliveryService.attempt (MODEL-SERVE-022 D04)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('marks a delivery SENT after a successful e-mail send', async () => {
    const prisma = buildPrisma({
      user: { findMany: jest.fn().mockResolvedValue([{ email: 'a@b.com' }]) },
    });
    const service = new NotificationDeliveryService(
      prisma as never,
      buildMailer() as never,
    );
    const row = { id: 'd-1', attempts: 0, payload, channel: emailChannel };
    await service.attempt(row as never);
    const calls = prisma.notificationDelivery.update.mock.calls as unknown[][];
    const call = calls[0][0] as {
      where: { id: string };
      data: { status: string };
    };
    expect(call.where).toEqual({ id: 'd-1' });
    expect(call.data.status).toBe('SENT');
  });

  it('does not send when it loses the claim race (another drain pass already claimed it)', async () => {
    const prisma = buildPrisma({
      notificationDelivery: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const mailer = buildMailer();
    const service = new NotificationDeliveryService(
      prisma as never,
      mailer as never,
    );
    const row = { id: 'd-1', attempts: 0, payload, channel: emailChannel };
    await service.attempt(row as never);
    expect(mailer.sendMail).not.toHaveBeenCalled();
    expect(prisma.notificationDelivery.update).not.toHaveBeenCalled();
  });

  it('a non-2xx Teams response is a delivery FAILURE, backed off geometrically, never a success', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500 }) as never;
    const prisma = buildPrisma();
    const service = new NotificationDeliveryService(
      prisma as never,
      buildMailer() as never,
    );
    const row = { id: 'd-2', attempts: 0, payload, channel: teamsChannel };
    await service.attempt(row as never);
    const calls = prisma.notificationDelivery.update.mock.calls as unknown[][];
    const call = calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.status).toBe('PENDING');
    expect(call.data.attempts).toBe(1);
    // 2^(1-1) = 1 minute.
    const nextAttemptAt = call.data.nextAttemptAt as Date;
    expect(nextAttemptAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 59_000);
    expect(nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 61_000);
  });

  it('reaches terminal FAILED after NOTIFY_DELIVERY_MAX_ATTEMPTS, with lastError set', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500 }) as never;
    const prisma = buildPrisma();
    const service = new NotificationDeliveryService(
      prisma as never,
      buildMailer() as never,
    );
    // env.NOTIFY_DELIVERY_MAX_ATTEMPTS defaults to 5 — attempts=4 going in
    // means this failure becomes the 5th and final one.
    const row = { id: 'd-3', attempts: 4, payload, channel: teamsChannel };
    await service.attempt(row as never);
    const calls = prisma.notificationDelivery.update.mock.calls as unknown[][];
    const call = calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.status).toBe('FAILED');
    expect(call.data.attempts).toBe(5);
    expect(call.data.lastError).toBeDefined();
  });

  it('a send error message is redacted before being stored as lastError', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new Error('fetch failed: https://hooks.example.com/x?sig=SECRET'),
      ) as never;
    const prisma = buildPrisma();
    const service = new NotificationDeliveryService(
      prisma as never,
      buildMailer() as never,
    );
    const row = { id: 'd-4', attempts: 0, payload, channel: teamsChannel };
    await service.attempt(row as never);
    const calls = prisma.notificationDelivery.update.mock.calls as unknown[][];
    const call = calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.lastError).not.toContain('sig=SECRET');
  });
});
