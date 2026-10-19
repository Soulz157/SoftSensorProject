import { env } from '@/config/env.config';
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest mocks are `any` by design */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthAuthorizedService } from './auth.authorized.service';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

jest.mock('@softsensor/common', () => ({
  AppException: class AppException extends Error {
    readonly statusCode: number;
    readonly type: string;

    constructor(body: { statusCode: number; message: string; type: string }) {
      super(body.message);
      this.statusCode = body.statusCode;
      this.type = body.type;
    }
  },
}));

jest.mock('@softsensor/prisma', () => ({
  PrismaService: jest.fn(),
  PrismaEnums: { AuthAction: { LOGOUT: 'LOGOUT', LOGIN: 'LOGIN' } },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface PrismaMock {
  refreshToken: Record<
    'findUnique' | 'delete' | 'create' | 'deleteMany' | 'updateMany',
    jest.Mock
  >;
  authLog: { create: jest.Mock };
  $transaction: jest.Mock;
}

/** Typed first arguments of a mock's calls — `mock.calls` is `any`. */
function argsOf<T>(fn: jest.Mock): T[] {
  return (fn.mock.calls as [T][]).map(([arg]) => arg);
}

interface RotateArgs {
  where: { token: string; revokedAt: null };
  data: { revokedAt: Date; replacedById: string };
}
interface CreateArgs {
  data: { id: string; token: string; userId: string; expiresAt: Date };
}
interface CleanupArgs {
  where: { userId: string; revokedAt: { lt: Date } };
}

function buildPrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    refreshToken: {
      findUnique: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      // The rotation's compare-and-swap. Default: this request wins it.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    authLog: {
      create: jest.fn(),
    },
    // Array form (logout) resolves the ops; callback form (refresh rotation)
    // runs against this same mock as `tx`.
    $transaction: jest.fn(
      (arg: unknown): Promise<unknown> =>
        typeof arg === 'function'
          ? (arg as (tx: PrismaMock) => Promise<unknown>)(mock)
          : Promise.resolve(arg),
    ),
  };
  return mock;
}

function buildUser(overrides: Partial<Auth.UserPayload & { id: string }> = {}) {
  return {
    id: 'user-id-1',
    email: 'user@example.com',
    firstName: 'Test',
    lastName: 'User',
    company: 'Acme',
    role: 'USER',
    ...overrides,
  };
}

function buildRecord(overrides: Record<string, unknown> = {}) {
  const user = buildUser();
  return {
    token: 'valid-refresh-token',
    userId: user.id,
    expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
    revokedAt: null,
    replacedById: null,
    user,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthAuthorizedService', () => {
  let service: AuthAuthorizedService;
  let prismaMock: ReturnType<typeof buildPrismaMock>;
  let jwtMock: { sign: jest.Mock };

  beforeEach(async () => {
    prismaMock = buildPrismaMock();
    jwtMock = { sign: jest.fn().mockReturnValue('mocked.access.token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthAuthorizedService,
        { provide: 'PrismaService', useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
      ],
    })
      .overrideProvider(AuthAuthorizedService)
      .useFactory({
        factory: () =>
          new AuthAuthorizedService(
            prismaMock as never,
            jwtMock as never,
            {
              sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
            } as never,
          ),
      })
      .compile();

    service = module.get<AuthAuthorizedService>(AuthAuthorizedService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // refreshService
  // -------------------------------------------------------------------------

  describe('refreshService', () => {
    it('TC-01: should return accessToken and new refreshToken on valid token', async () => {
      // Arrange
      const record = buildRecord();
      prismaMock.refreshToken.findUnique.mockResolvedValue(record);

      // Act
      const result = await service.refreshService('valid-refresh-token');

      // Assert
      expect((result.response as Record<string, unknown>).statusCode).toBe(200);
      expect((result.response as Record<string, unknown>).data).toEqual({
        accessToken: 'mocked.access.token',
      });
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken).toHaveLength(128); // 64 bytes → 128 hex chars
    });

    it('TC-02: rotates by revoking the old token (compare-and-swap) and creating its successor, never deleting it', async () => {
      // Arrange
      prismaMock.refreshToken.findUnique.mockResolvedValue(buildRecord());

      // Act
      const result = await service.refreshService('valid-refresh-token');

      // Assert
      expect(prismaMock.refreshToken.delete).not.toHaveBeenCalled();
      const [cas] = argsOf<RotateArgs>(prismaMock.refreshToken.updateMany);
      expect(cas.where).toEqual({
        token: 'valid-refresh-token',
        revokedAt: null,
      });
      const [created] = argsOf<CreateArgs>(prismaMock.refreshToken.create);
      expect(cas.data.replacedById).toBe(created.data.id);
      expect(cas.data.revokedAt).toBeInstanceOf(Date);
      expect(created.data.token).toBe(result.refreshToken);
      expect(created.data.userId).toBe('user-id-1');
    });

    it('TC-02b: drops this user’s tokens revoked before the grace window', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(buildRecord());
      const before = Date.now();

      await service.refreshService('valid-refresh-token');

      const [cleanup] = argsOf<CleanupArgs>(prismaMock.refreshToken.deleteMany);
      expect(cleanup.where.userId).toBe('user-id-1');
      const cutoff = cleanup.where.revokedAt.lt.getTime();
      expect(cutoff).toBeLessThanOrEqual(before - 30_000 + 1000);
      expect(cutoff).toBeGreaterThanOrEqual(before - 30_000 - 1000);
    });

    it('TC-03: should call jwtService.sign with correct user fields and the configured access expiry', async () => {
      // Arrange
      const user = buildUser({
        firstName: 'Jane',
        lastName: 'Doe',
        company: 'Corp',
      });
      prismaMock.refreshToken.findUnique.mockResolvedValue(
        buildRecord({ user }),
      );
      prismaMock.$transaction.mockResolvedValue([undefined, undefined]);

      // Act
      await service.refreshService('valid-refresh-token');

      // Assert
      expect(jwtMock.sign).toHaveBeenCalledWith(
        {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          company: user.company,
          role: user.role,
        },
        { expiresIn: env.JWT_ACCESS_EXPIRES },
      );
    });

    it('TC-04: should throw AppException 401 when token is not found', async () => {
      // Arrange
      prismaMock.refreshToken.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.refreshService('nonexistent-token'),
      ).rejects.toMatchObject({
        statusCode: 401,
        message: 'Refresh token invalid or expired',
      });
    });

    it('TC-05: should throw AppException 401 when token is expired', async () => {
      // Arrange
      const expiredRecord = buildRecord({
        expiresAt: new Date(Date.now() - 1000), // 1 second in the past
      });
      prismaMock.refreshToken.findUnique.mockResolvedValue(expiredRecord);

      // Act & Assert
      await expect(
        service.refreshService('expired-token'),
      ).rejects.toMatchObject({
        statusCode: 401,
        message: 'Refresh token invalid or expired',
      });
    });

    it('TC-06: should throw AppException 401 when token has been revoked', async () => {
      // Arrange
      const revokedRecord = buildRecord({ revokedAt: new Date() });
      prismaMock.refreshToken.findUnique.mockResolvedValue(revokedRecord);

      // Act & Assert
      await expect(
        service.refreshService('revoked-token'),
      ).rejects.toMatchObject({
        statusCode: 401,
        message: 'Refresh token invalid or expired',
      });
    });

    it('TC-07: should set expiresAt on new refresh token within 5 seconds of 7-day TTL', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(buildRecord());
      const beforeCall = Date.now();

      await service.refreshService('valid-refresh-token');

      const [created] = argsOf<CreateArgs>(prismaMock.refreshToken.create);
      const actualExpiry = created.data.expiresAt.getTime();
      const expectedExpiry = beforeCall + SEVEN_DAYS_MS;
      expect(actualExpiry).toBeGreaterThanOrEqual(expectedExpiry - 5000);
      expect(actualExpiry).toBeLessThanOrEqual(expectedExpiry + 5000);
    });

    // --- Rotation grace window: concurrent refreshes with one token -------

    it('TC-07b: a token rotated seconds ago returns its live successor, not a 401', async () => {
      const revoked = buildRecord({
        revokedAt: new Date(Date.now() - 5_000),
        replacedById: 'next-id',
      });
      prismaMock.refreshToken.findUnique.mockImplementation(
        (args: { where: { token?: string; id?: string } }) =>
          Promise.resolve(
            args.where.id === 'next-id'
              ? buildRecord({ token: 'next-token', revokedAt: null })
              : revoked,
          ),
      );

      const result = await service.refreshService('valid-refresh-token');

      expect(result.refreshToken).toBe('next-token');
      expect((result.response as Record<string, unknown>).statusCode).toBe(200);
      // No second rotation from the grace path.
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('TC-07c: reuse after the grace window is refused', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(
        buildRecord({
          revokedAt: new Date(Date.now() - 31_000),
          replacedById: 'next-id',
        }),
      );

      await expect(
        service.refreshService('valid-refresh-token'),
      ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('TC-07d: refused when the successor is itself revoked or gone', async () => {
      const revoked = buildRecord({
        revokedAt: new Date(Date.now() - 5_000),
        replacedById: 'next-id',
      });
      prismaMock.refreshToken.findUnique.mockImplementation(
        (args: { where: { id?: string } }) =>
          Promise.resolve(
            args.where.id === 'next-id'
              ? buildRecord({ token: 'next-token', revokedAt: new Date() })
              : revoked,
          ),
      );

      await expect(
        service.refreshService('valid-refresh-token'),
      ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('TC-07e: losing the compare-and-swap race answers with the winner’s token', async () => {
      let reads = 0;
      prismaMock.refreshToken.findUnique.mockImplementation(
        (args: { where: { token?: string; id?: string } }) => {
          if (args.where.id === 'winner-id') {
            return Promise.resolve(
              buildRecord({ token: 'winner-token', revokedAt: null }),
            );
          }
          reads += 1;
          // First read: still live. Re-read after losing: rotated by the winner.
          return Promise.resolve(
            reads === 1
              ? buildRecord()
              : buildRecord({
                  revokedAt: new Date(),
                  replacedById: 'winner-id',
                }),
          );
        },
      );
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.refreshService('valid-refresh-token');

      expect(result.refreshToken).toBe('winner-token');
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // logoutService
  // -------------------------------------------------------------------------

  describe('logoutService', () => {
    it('TC-08: should call $transaction with deleteMany and authLog.create, return 200 SUCCESS', async () => {
      // Arrange
      prismaMock.$transaction.mockResolvedValue([undefined, undefined]);
      const userId = 'user-id-1';

      // Act
      const result = await service.logoutService(userId, {
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
      });

      // Assert
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        statusCode: 200,
        message: 'ออกจากระบบสำเร็จ',
        type: 'SUCCESS',
      });
    });

    it('TC-09: should forward ipAddress and userAgent to authLog.create data', async () => {
      // Arrange
      const userId = 'user-id-1';
      const meta = { ipAddress: '192.168.1.1', userAgent: 'Mozilla/5.0' };
      prismaMock.authLog.create.mockImplementation(
        (args: { data: Record<string, unknown> }) => Promise.resolve(args.data),
      );
      prismaMock.$transaction.mockImplementation((ops: unknown[]) =>
        Promise.resolve(ops),
      );

      // Act
      await service.logoutService(userId, meta);

      // Assert — authLog.create should have been invoked with the right data
      expect(prismaMock.authLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          }),
        }),
      );
    });

    it('TC-10: should work when meta is undefined', async () => {
      // Arrange
      prismaMock.$transaction.mockResolvedValue([undefined, undefined]);
      const userId = 'user-id-1';

      // Act & Assert — should not throw
      await expect(service.logoutService(userId)).resolves.toEqual({
        statusCode: 200,
        message: 'ออกจากระบบสำเร็จ',
        type: 'SUCCESS',
      });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
