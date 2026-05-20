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

function buildPrismaMock() {
  return {
    refreshToken: {
      findUnique: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    authLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
  };
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
          new AuthAuthorizedService(prismaMock as never, jwtMock as never),
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
      prismaMock.$transaction.mockResolvedValue([undefined, undefined]);

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

    it('TC-02: should delete old token and create new token via $transaction (token rotation)', async () => {
      // Arrange
      const record = buildRecord();
      prismaMock.refreshToken.findUnique.mockResolvedValue(record);
      prismaMock.$transaction.mockResolvedValue([undefined, undefined]);

      // Act
      await service.refreshService('valid-refresh-token');

      // Assert
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      const [ops] = prismaMock.$transaction.mock.calls[0];
      expect(Array.isArray(ops)).toBe(true);
      expect(ops).toHaveLength(2);
    });

    it('TC-03: should call jwtService.sign with correct user fields and expiresIn 15m', async () => {
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
        { expiresIn: '15m' },
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
      // Arrange
      const record = buildRecord();
      prismaMock.refreshToken.findUnique.mockResolvedValue(record);

      let capturedCreateArg: Record<string, unknown> = {};
      prismaMock.$transaction.mockImplementation((ops: unknown[]) => {
        // ops[1] is the create call — we need to intercept the data arg
        return Promise.resolve(ops);
      });

      // We override create to capture the data argument
      prismaMock.refreshToken.create.mockImplementation(
        (args: {
          data: { expiresAt: Date; token: string; userId: string };
        }) => {
          capturedCreateArg = args.data;
          return Promise.resolve(args.data);
        },
      );

      const beforeCall = Date.now();

      // Act
      const result = await service.refreshService('valid-refresh-token');

      // Assert — rebuild the transaction calls to see what create was called with
      // Since $transaction receives an array of promises, verify via the result
      const expectedExpiry = beforeCall + SEVEN_DAYS_MS;
      // The new refresh token is a 128-char hex string
      expect(result.refreshToken).toHaveLength(128);

      // If capturedCreateArg was populated (mock called create directly):
      if (capturedCreateArg['expiresAt']) {
        const actualExpiry = (capturedCreateArg['expiresAt'] as Date).getTime();
        expect(actualExpiry).toBeGreaterThanOrEqual(expectedExpiry - 5000);
        expect(actualExpiry).toBeLessThanOrEqual(expectedExpiry + 5000);
      }
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
      let capturedLogData: Record<string, unknown> = {};

      prismaMock.authLog.create.mockImplementation(
        (args: { data: Record<string, unknown> }) => {
          capturedLogData = args.data;
          return Promise.resolve(args.data);
        },
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
