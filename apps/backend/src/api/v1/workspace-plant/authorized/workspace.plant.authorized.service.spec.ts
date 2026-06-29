import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePlantAuthorizedService } from './workspace.plant.authorized.service';

describe('WorkspacePlantAuthorizedService', () => {
  let service: WorkspacePlantAuthorizedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkspacePlantAuthorizedService],
    }).compile();

    service = module.get<WorkspacePlantAuthorizedService>(
      WorkspacePlantAuthorizedService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
