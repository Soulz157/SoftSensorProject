import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthPublicService } from './auth.public.service';
import { OAuthLoginRequestDto } from './dto/auth.public.dto';

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
  PrismaEnums: {
    AuthAction: { LOGIN: 'LOGIN', LOGOUT: 'LOGOUT' },
    Role: { USER: 'USER', ADMIN: 'ADMIN' },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPrismaMock() {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    account: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
    },
    authLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
  };
}

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-id-1',
    email: 'user@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    password: null,
    company: null,
    role: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildGraphProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'graph-user-id-1',
    mail: 'user@example.com',
    userPrincipalName: 'user@example.com',
    givenName: 'Jane',
    surname: 'Doe',
    displayName: 'Jane Doe',
    ...overrides,
  };
}

function mockGraphResponse(
  ok: boolean,
  payload: Record<string, unknown> | null = null,
) {
  return {
    ok,
    status: ok ? 200 : 401,
    json: jest.fn().mockResolvedValue(payload),
  };
}

function buildDto(
  overrides: Partial<OAuthLoginRequestDto> = {},
): OAuthLoginRequestDto {
  return {
    provider: 'microsoft',
    providerAccountId: 'graph-user-id-1',
    email: 'user@example.com',
    accessToken: 'ms-access-token',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthPublicService', () => {
  let service: AuthPublicService;
  let prismaMock: ReturnType<typeof buildPrismaMock>;
  let jwtMock: { sign: jest.Mock };
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    prismaMock = buildPrismaMock();
    jwtMock = { sign: jest.fn().mockReturnValue('signed.jwt.token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthPublicService,
        { provide: 'PrismaService', useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
      ],
    })
      .overrideProvider(AuthPublicService)
      .useFactory({
        factory: () =>
          new AuthPublicService(prismaMock as never, jwtMock as never),
      })
      .compile();

    service = module.get<AuthPublicService>(AuthPublicService);

    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        mockGraphResponse(true, buildGraphProfile()) as unknown as Response,
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // oauthLoginService
  // -------------------------------------------------------------------------

  describe('oauthLoginService', () => {
    it('TC-01: rejects unsupported provider (google) with BadRequestException', async () => {
      // Arrange
      const dto = buildDto({ provider: 'google' });

      // Act & Assert
      await expect(service.oauthLoginService(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.oauthLoginService(dto)).rejects.toThrow(
        'Provider not supported',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('TC-02: throws UnauthorizedException when Microsoft Graph returns non-OK', async () => {
      // Arrange
      fetchSpy.mockResolvedValueOnce(mockGraphResponse(false));

      // Act & Assert
      await expect(
        service.oauthLoginService(buildDto()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer ms-access-token',
          }),
        }),
      );
    });

    it('TC-03: throws UnauthorizedException on identity mismatch between DTO and Graph', async () => {
      // Arrange — Graph returns a different id than the DTO claims (every call)
      fetchSpy.mockResolvedValue(
        mockGraphResponse(
          true,
          buildGraphProfile({ id: 'different-graph-id' }),
        ),
      );

      // Act & Assert
      await expect(
        service.oauthLoginService(buildDto()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.oauthLoginService(buildDto())).rejects.toThrow(
        'OAuth identity mismatch',
      );
    });

    it('TC-04: auto-provisions new User + Account when neither exists', async () => {
      // Arrange
      prismaMock.account.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue(null);
      const created = buildUser({ id: 'new-user-id' });
      prismaMock.user.create.mockResolvedValue(created);

      // Act
      const result = await service.oauthLoginService(buildDto(), {
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
      });

      // Assert — user.create called with nested Account create + null tokens
      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'user@example.com',
            firstName: 'Jane',
            lastName: 'Doe',
            password: null,
            role: 'USER',
            accounts: {
              create: expect.objectContaining({
                provider: 'microsoft',
                providerAccountId: 'graph-user-id-1',
                accessToken: null,
                refreshToken: null,
                expiresAt: null,
              }),
            },
          }),
        }),
      );

      // RefreshToken + AuthLog persisted inside a single $transaction
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      const [ops] = prismaMock.$transaction.mock.calls[0];
      expect(Array.isArray(ops)).toBe(true);
      expect(ops).toHaveLength(2);

      // Response shape matches controller's destructure
      expect(result.response).toEqual({
        statusCode: 200,
        message: 'OAuth login successful',
        data: { accessToken: 'signed.jwt.token' },
      });
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken).toHaveLength(128); // 64 bytes → 128 hex chars

      // JWT signed with resolved user's fields + 15m TTL
      expect(jwtMock.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new-user-id',
          email: 'user@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
          role: 'USER',
        }),
        { expiresIn: '15m' },
      );
    });

    it('TC-05: links Account to existing User when email matches but no Account', async () => {
      // Arrange
      prismaMock.account.findUnique.mockResolvedValue(null);
      const existingUser = buildUser({
        id: 'existing-user-id',
        password: 'hashed-password',
      });
      prismaMock.user.findUnique.mockResolvedValue(existingUser);
      prismaMock.account.create.mockResolvedValue({ id: 'new-account-id' });

      // Act
      const result = await service.oauthLoginService(buildDto());

      // Assert
      expect(prismaMock.account.create).toHaveBeenCalledWith({
        data: {
          userId: 'existing-user-id',
          provider: 'microsoft',
          providerAccountId: 'graph-user-id-1',
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
        },
      });
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(jwtMock.sign).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'existing-user-id' }),
        { expiresIn: '15m' },
      );
      expect(result.response).toMatchObject({
        statusCode: 200,
        message: 'OAuth login successful',
      });
    });

    it('TC-06: reuses existing Account and its linked User without re-creating anything', async () => {
      // Arrange
      const linkedUser = buildUser({ id: 'linked-user-id' });
      prismaMock.account.findUnique.mockResolvedValue({
        id: 'account-id',
        userId: linkedUser.id,
        provider: 'microsoft',
        providerAccountId: 'graph-user-id-1',
        user: linkedUser,
      });

      // Act
      const result = await service.oauthLoginService(buildDto());

      // Assert — no User or Account creation, just token issue
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(prismaMock.account.create).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(jwtMock.sign).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'linked-user-id' }),
        { expiresIn: '15m' },
      );
      expect(result.response).toMatchObject({
        statusCode: 200,
        data: { accessToken: 'signed.jwt.token' },
      });
    });
  });
});
