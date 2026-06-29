import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePlantPublicService } from './workspace.plant.public.service';

describe('WorkspacePlantPublicService', () => {
  let service: WorkspacePlantPublicService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkspacePlantPublicService],
    }).compile();

    service = module.get<WorkspacePlantPublicService>(
      WorkspacePlantPublicService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
