import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePublicService } from './workspace-public.service';

describe('WorkspacePublicService', () => {
  let service: WorkspacePublicService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkspacePublicService],
    }).compile();

    service = module.get<WorkspacePublicService>(WorkspacePublicService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
