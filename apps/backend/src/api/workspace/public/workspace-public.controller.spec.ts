import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePublicController } from './workspace-public.controller';

describe('WorkspacePublicController', () => {
  let controller: WorkspacePublicController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspacePublicController],
    }).compile();

    controller = module.get<WorkspacePublicController>(
      WorkspacePublicController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
