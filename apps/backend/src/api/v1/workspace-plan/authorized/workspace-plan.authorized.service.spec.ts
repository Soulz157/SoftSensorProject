import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePlanAuthorizedService } from './workspace-plan.authorized.service';

describe('WorkspacePlanAuthorizedService', () => {
  let service: WorkspacePlanAuthorizedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkspacePlanAuthorizedService],
    }).compile();

    service = module.get<WorkspacePlanAuthorizedService>(
      WorkspacePlanAuthorizedService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
