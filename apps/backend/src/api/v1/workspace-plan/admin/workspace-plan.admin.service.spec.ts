import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePlanAdminService } from './workspace-plan.admin.service';

describe('WorkspacePlanAdminService', () => {
  let service: WorkspacePlanAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkspacePlanAdminService],
    }).compile();

    service = module.get<WorkspacePlanAdminService>(WorkspacePlanAdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
