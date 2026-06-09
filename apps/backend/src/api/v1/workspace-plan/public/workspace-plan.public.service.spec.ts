import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePlanPublicService } from './workspace-plan.public.service';

describe('WorkspacePlanPublicService', () => {
  let service: WorkspacePlanPublicService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkspacePlanPublicService],
    }).compile();

    service = module.get<WorkspacePlanPublicService>(
      WorkspacePlanPublicService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
