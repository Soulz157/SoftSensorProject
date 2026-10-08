import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthAdminService } from './auth.admin.service';

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
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
