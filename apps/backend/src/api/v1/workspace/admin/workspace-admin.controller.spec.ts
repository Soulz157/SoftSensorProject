import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceAdminController } from './workspace-admin.controller';

describe('WorkspaceAdminController', () => {
  let controller: WorkspaceAdminController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceAdminController],
    }).compile();

    controller = module.get<WorkspaceAdminController>(WorkspaceAdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
