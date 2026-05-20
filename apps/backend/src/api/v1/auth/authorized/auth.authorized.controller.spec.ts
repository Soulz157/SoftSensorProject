import { Test, TestingModule } from '@nestjs/testing';
import { AuthAuthorizedController } from './auth.authorized.controller';
import { AuthAuthorizedService } from './auth.authorized.service';

// ---------------------------------------------------------------------------
// Module mocks — declared before any code that transitively imports them
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

// The controller imports these via path aliases that Jest cannot resolve without
// moduleNameMapper. We mock them so Jest can load the module graph.
jest.mock('src/guards/jwt-access.guard', () => ({
  JwtAccessGuard: class JwtAccessGuard {
    canActivate() {
      return true;
    }
  },
}));

jest.mock('src/common/decorators/user.decorator', () => ({
  Users: () => jest.fn(),
}));

jest.mock('@/config/cookie.config', () => ({
  REFRESH_TOKEN_COOKIE: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/v1/authorized/auth/refresh',
  },
  CLEAR_REFRESH_TOKEN_COOKIE: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 0,
    path: '/api/v1/authorized/auth/refresh',
  },
}));

// Swagger decorators do nothing at test time
jest.mock('@nestjs/swagger', () => ({
  ApiBearerAuth: () => jest.fn(),
  ApiTags: () => jest.fn(),
  ApiOperation: () => jest.fn(),
  ApiOkResponse: () => jest.fn(),
  ApiUnauthorizedResponse: () => jest.fn(),
}));

// src/lib/dto has no side-effects we need; stub it
jest.mock('src/lib/dto', () => ({
  ResponseFailedDto: class ResponseFailedDto {},
  createStandardResponseSchema: jest.fn(),
}));

// The DTO file imports from nestjs-zod and zod — stub it so module load succeeds
jest.mock('./dto/auth.authorized.dto', () => ({
  LogoutResponseDto: class LogoutResponseDto {},
  RefreshResponseDto: class RefreshResponseDto {},
  GetMeResponseDto: class GetMeResponseDto {},
  EditRequestDto: class EditRequestDto {},
}));

// ---------------------------------------------------------------------------
// Constants (re-exported from the mocked cookie.config above)
// ---------------------------------------------------------------------------
const REFRESH_TOKEN_COOKIE = {
  httpOnly: true,
  secure: false,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/v1/authorized/auth/refresh',
};

const CLEAR_REFRESH_TOKEN_COOKIE = {
  ...REFRESH_TOKEN_COOKIE,
  maxAge: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildServiceMock() {
  return {
    refreshService: jest.fn(),
    logoutService: jest.fn(),
  };
}

function buildUser(
  overrides: Partial<Auth.UserPayload> = {},
): Auth.UserPayload {
  return {
    id: 'user-id-1',
    email: 'user@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: 'USER',
    company: 'Acme',
    ...overrides,
  };
}

function buildFastifyRequest(overrides: Record<string, unknown> = {}) {
  return {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'TestAgent/1.0' },
    cookies: {},
    ...overrides,
  };
}

function buildFastifyReply() {
  return {
    setCookie: jest.fn(),
    clearCookie: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthAuthorizedController', () => {
  let controller: AuthAuthorizedController;
  let serviceMock: ReturnType<typeof buildServiceMock>;

  beforeEach(async () => {
    serviceMock = buildServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthAuthorizedController],
      providers: [{ provide: AuthAuthorizedService, useValue: serviceMock }],
    }).compile();

    controller = module.get<AuthAuthorizedController>(AuthAuthorizedController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // refreshController
  // -------------------------------------------------------------------------

  describe('refreshController', () => {
    it('TC-11: should read refresh_token cookie, call service, set new cookie, and return response', async () => {
      // Arrange
      const existingToken = 'existing-refresh-token';
      const newRefreshToken = 'a'.repeat(128);
      const serviceResponse = {
        statusCode: 200,
        message: 'Token refreshed successfully',
        type: 'SUCCESS',
        data: { accessToken: 'new.access.token' },
      };

      serviceMock.refreshService.mockResolvedValue({
        response: serviceResponse,
        refreshToken: newRefreshToken,
      });

      const req = buildFastifyRequest({
        cookies: { refresh_token: existingToken },
      });
      const res = buildFastifyReply();

      // Act
      const result = await controller.refreshController(
        req as never,
        res as never,
      );

      // Assert
      expect(serviceMock.refreshService).toHaveBeenCalledWith(existingToken);
      expect(res.setCookie).toHaveBeenCalledWith(
        'refresh_token',
        newRefreshToken,
        REFRESH_TOKEN_COOKIE,
      );
      expect(result).toEqual(serviceResponse);
    });

    it('TC-12: should call res.setCookie with the REFRESH_TOKEN_COOKIE options', async () => {
      // Arrange
      const newRefreshToken = 'b'.repeat(128);
      serviceMock.refreshService.mockResolvedValue({
        response: { statusCode: 200 },
        refreshToken: newRefreshToken,
      });

      const req = buildFastifyRequest({ cookies: { refresh_token: 'tok' } });
      const res = buildFastifyReply();

      // Act
      await controller.refreshController(req as never, res as never);

      // Assert
      expect(res.setCookie).toHaveBeenCalledTimes(1);
      const [, , cookieOptions] = res.setCookie.mock.calls[0] as [
        string,
        string,
        typeof REFRESH_TOKEN_COOKIE,
      ];
      expect(cookieOptions).toEqual(REFRESH_TOKEN_COOKIE);
    });

    it('TC-13: should pass empty string to service when cookies are missing', async () => {
      // Arrange
      serviceMock.refreshService.mockResolvedValue({
        response: { statusCode: 200 },
        refreshToken: 'c'.repeat(128),
      });

      // req.cookies is undefined — controller falls back to ''
      const req = buildFastifyRequest({ cookies: undefined });
      const res = buildFastifyReply();

      // Act
      await controller.refreshController(req as never, res as never);

      // Assert — service receives '' (controller responsibility only)
      expect(serviceMock.refreshService).toHaveBeenCalledWith('');
    });
  });

  // -------------------------------------------------------------------------
  // logoutController
  // -------------------------------------------------------------------------

  describe('logoutController', () => {
    it('TC-14: should call logoutService with user id, ip, and userAgent, then return result', async () => {
      // Arrange
      const user = buildUser();
      const logoutResult = {
        statusCode: 200,
        message: 'ออกจากระบบสำเร็จ',
        type: 'SUCCESS',
      };
      serviceMock.logoutService.mockResolvedValue(logoutResult);

      const req = buildFastifyRequest({
        ip: '10.0.0.1',
        headers: { 'user-agent': 'Chrome/120' },
      });
      const reply = buildFastifyReply();

      // Act
      const result = await controller.logoutController(
        user,
        req as never,
        reply as never,
      );

      // Assert
      expect(serviceMock.logoutService).toHaveBeenCalledWith(user.id, {
        ipAddress: '10.0.0.1',
        userAgent: 'Chrome/120',
      });
      expect(result).toEqual(logoutResult);
    });

    it('TC-15: should call reply.clearCookie with CLEAR_REFRESH_TOKEN_COOKIE options', async () => {
      // Arrange
      const user = buildUser();
      serviceMock.logoutService.mockResolvedValue({
        statusCode: 200,
        message: 'ออกจากระบบสำเร็จ',
        type: 'SUCCESS',
      });

      const req = buildFastifyRequest();
      const reply = buildFastifyReply();

      // Act
      await controller.logoutController(user, req as never, reply as never);

      // Assert
      expect(reply.clearCookie).toHaveBeenCalledTimes(1);
      expect(reply.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        CLEAR_REFRESH_TOKEN_COOKIE,
      );
    });
  });
});
