import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceAuthorizedController } from './workspace.authorized.controller';

describe('WorkspaceAuthorizedController', () => {
  let controller: WorkspaceAuthorizedController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceAuthorizedController],
    }).compile();

    controller = module.get<WorkspaceAuthorizedController>(
      WorkspaceAuthorizedController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
