import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceAdminService } from './workspace.admin.service';
import { PrismaService } from '@softsensor/prisma';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceAdminService', () => {
  let service: WorkspaceAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceAdminService,
        {
          provide: PrismaService,
          useValue: {
            workspace: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WorkspaceAdminService>(WorkspaceAdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
