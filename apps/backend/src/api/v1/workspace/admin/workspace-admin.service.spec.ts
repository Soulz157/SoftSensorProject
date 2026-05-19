import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceAdminService } from './workspace-admin.service';

describe('WorkspaceAdminService', () => {
  let service: WorkspaceAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkspaceAdminService],
    }).compile();

    service = module.get<WorkspaceAdminService>(WorkspaceAdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
