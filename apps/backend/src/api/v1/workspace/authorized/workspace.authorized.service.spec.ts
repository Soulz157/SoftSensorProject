import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceAuthorizedService } from './workspace.authorized.service';

describe('WorkspaceAuthorizedService', () => {
  let service: WorkspaceAuthorizedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkspaceAuthorizedService],
    }).compile();

    service = module.get<WorkspaceAuthorizedService>(
      WorkspaceAuthorizedService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
