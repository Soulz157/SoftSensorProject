import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthAdminService } from './auth.admin.service';
import { OAuthLoginRequestDto } from './dto/auth.admin.dto';

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

describe('AuthAdminService', () => {
  let service: AuthAdminService;
  let prismaMock: ReturnType<typeof buildPrismaMock>;
  let jwtMock: { sign: jest.Mock };

  beforeEach(async () => {
    prismaMock = buildPrismaMock();
    jwtMock = { sign: jest.fn().mockReturnValue('signed.jwt.token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthAdminService,
        { provide: 'PrismaService', useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
      ],
    })
      .overrideProvider(AuthAdminService)
      .useFactory({
        factory: () => new AuthAdminService(prismaMock as never),
      })
      .compile();

    service = module.get<AuthAdminService>(AuthAdminService);

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
});
