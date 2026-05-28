import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceAdminController } from './workspace.admin.controller';
import { WorkspaceAdminService } from './workspace.admin.service';

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

jest.mock('@/guards/roles.guard', () => ({
  RolesGuard: class RolesGuard {
    canActivate() {
      return true;
    }
  },
}));

jest.mock('@/common/decorators/user.decorator', () => ({
  Users: () => jest.fn(),
}));

jest.mock('@/common/decorators/roles.decorator', () => ({
  Roles: () => jest.fn(),
}));

jest.mock('@/lib/dto', () => ({
  ResponseFailedDto: class ResponseFailedDto {},
}));

jest.mock('@nestjs/swagger', () => ({
  ApiTags: () => jest.fn(),
  ApiOperation: () => jest.fn(),
  ApiOkResponse: () => jest.fn(),
  ApiBadRequestResponse: () => jest.fn(),
}));

jest.mock('./dto/workspace.admin.dto', () => ({
  CreateWorkspaceRequestDto: class CreateWorkspaceRequestDto {},
  CreateWorkspaceResponseDto: class CreateWorkspaceResponseDto {},
  UpdateWorkspaceRequestDto: class UpdateWorkspaceRequestDto {},
  DeleteWorkspaceRequestDto: class DeleteWorkspaceRequestDto {},
  DeleteWorkspaceResponseDto: class DeleteWorkspaceResponseDto {},
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceAdminController', () => {
  let controller: WorkspaceAdminController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceAdminController],
      providers: [
        {
          provide: WorkspaceAdminService,
          useValue: {
            createWorkspace: jest.fn(),
            updateWorkspace: jest.fn(),
            deleteWorkspace: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<WorkspaceAdminController>(WorkspaceAdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
