import { Test, TestingModule } from '@nestjs/testing';
import { PlanAdminController } from './plan.admin.controller';
import { PlanAdminService } from './plan.admin.service';

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
  CreatePlanRequestDto: class CreatePlanRequestDto {},
  CreatePlanResponseDto: class CreatePlanResponseDto {},
  UpdatePlanRequestDto: class UpdatePlanRequestDto {},
  DeletePlanRequestDto: class DeletePlanRequestDto {},
  DeletePlanResponseDto: class DeletePlanResponseDto {},
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlanAdminController', () => {
  let controller: PlanAdminController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlanAdminController],
      providers: [
        {
          provide: PlanAdminService,
          useValue: {
            createPlan: jest.fn(),
            updatePlan: jest.fn(),
            deletePlan: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PlanAdminController>(PlanAdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
