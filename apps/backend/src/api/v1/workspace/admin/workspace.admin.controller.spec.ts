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
  PrismaEnums: { Role: { USER: 'USER', ADMIN: 'ADMIN' } },
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
  ApiBearerAuth: () => jest.fn(),
}));

jest.mock('./dto/workspace.admin.dto', () => ({
  CreateWorkspaceRequestDto: class CreateWorkspaceRequestDto {},
  CreateWorkspaceResponseDto: class CreateWorkspaceResponseDto {},
  UpdateWorkspaceRequestDto: class UpdateWorkspaceRequestDto {},
  DeleteWorkspaceRequestDto: class DeleteWorkspaceRequestDto {},
  DeleteWorkspaceResponseDto: class DeleteWorkspaceResponseDto {},
  AdminWorkspaceQueryDto: class AdminWorkspaceQueryDto {},
  AdminWorkspaceListResponseDto: class AdminWorkspaceListResponseDto {},
  AdminGetWorkspaceByIdResponseDto: class AdminGetWorkspaceByIdResponseDto {},
  AdminInviteMemberDto: class AdminInviteMemberDto {},
  AdminUpdateMemberRoleDto: class AdminUpdateMemberRoleDto {},
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceAdminController', () => {
  let controller: WorkspaceAdminController;
  let service: WorkspaceAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceAdminController],
      providers: [
        {
          provide: WorkspaceAdminService,
          useValue: {
            listWorkspaces: jest.fn(),
            getWorkspaceById: jest.fn(),
            createWorkspace: jest.fn(),
            updateWorkspace: jest.fn(),
            deleteWorkspace: jest.fn(),
            inviteMember: jest.fn(),
            updateMemberRole: jest.fn(),
            removeMember: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<WorkspaceAdminController>(WorkspaceAdminController);
    service = module.get<WorkspaceAdminService>(WorkspaceAdminService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getWorkspaceById delegates to service', async () => {
    const mockResult = { statusCode: 200, data: { id: 'ws-1' } };
    (service.getWorkspaceById as jest.Mock).mockResolvedValue(mockResult);
    const result = await controller.getWorkspaceById('ws-1');
    expect(service.getWorkspaceById).toHaveBeenCalledWith('ws-1');
    expect(result).toEqual(mockResult);
  });

  it('inviteMember delegates to service', async () => {
    const dto = { email: 'a@b.com', role: 'VIEWER' as const };
    const mockResult = { statusCode: 201, data: { id: 'm-1' } };
    (service.inviteMember as jest.Mock).mockResolvedValue(mockResult);
    const result = await controller.inviteMember('ws-1', dto);
    expect(service.inviteMember).toHaveBeenCalledWith('ws-1', dto);
    expect(result).toEqual(mockResult);
  });

  it('updateMemberRole delegates to service', async () => {
    const dto = { role: 'OWNER' as const };
    const mockResult = { statusCode: 200, data: { id: 'm-1' } };
    (service.updateMemberRole as jest.Mock).mockResolvedValue(mockResult);
    const result = await controller.updateMemberRole('ws-1', 'm-1', dto);
    expect(service.updateMemberRole).toHaveBeenCalledWith('ws-1', 'm-1', dto);
    expect(result).toEqual(mockResult);
  });

  it('removeMember delegates to service', async () => {
    const mockResult = { statusCode: 200, data: null };
    (service.removeMember as jest.Mock).mockResolvedValue(mockResult);
    const result = await controller.removeMember('ws-1', 'm-1');
    expect(service.removeMember).toHaveBeenCalledWith('ws-1', 'm-1');
    expect(result).toEqual(mockResult);
  });
});
