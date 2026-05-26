import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceAuthorizedService } from './workspace.authorized.service';
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
  PrismaEnums: { Role: { USER: 'USER', STAFF: 'STAFF', ADMIN: 'ADMIN' } },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceAuthorizedService', () => {
  let service: WorkspaceAuthorizedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceAuthorizedService,
        {
          provide: PrismaService,
          useValue: {
            workspace: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<WorkspaceAuthorizedService>(
      WorkspaceAuthorizedService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
