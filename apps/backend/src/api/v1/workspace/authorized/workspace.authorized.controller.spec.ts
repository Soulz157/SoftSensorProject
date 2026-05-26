import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceAuthorizedController } from './workspace.authorized.controller';
import { WorkspaceAuthorizedService } from './workspace.authorized.service';

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
  PrismaService: class {},
  PrismaEnums: { Role: { USER: 'USER', STAFF: 'STAFF', ADMIN: 'ADMIN' } },
}));

jest.mock('@/guards/jwt-access.guard', () => ({
  JwtAccessGuard: class JwtAccessGuard {
    canActivate() {
      return true;
    }
  },
}));

jest.mock('@/common/decorators/user.decorator', () => ({
  Users: () => jest.fn(),
}));

jest.mock('@nestjs/swagger', () => ({
  ApiTags: () => jest.fn(),
  ApiOperation: () => jest.fn(),
  ApiOkResponse: () => jest.fn(),
  ApiBadRequestResponse: () => jest.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceAuthorizedController', () => {
  let controller: WorkspaceAuthorizedController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceAuthorizedController],
      providers: [
        {
          provide: WorkspaceAuthorizedService,
          useValue: {
            getAllWorkspaces: jest.fn(),
            getWorkspaceById: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<WorkspaceAuthorizedController>(
      WorkspaceAuthorizedController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
