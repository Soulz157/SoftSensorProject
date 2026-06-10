import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePlantAdminService } from './workspace.plant.admin.service';

describe('WorkspacePlantAdminService', () => {
  let service: WorkspacePlantAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkspacePlantAdminService],
    }).compile();

    service = module.get<WorkspacePlantAdminService>(
      WorkspacePlantAdminService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
