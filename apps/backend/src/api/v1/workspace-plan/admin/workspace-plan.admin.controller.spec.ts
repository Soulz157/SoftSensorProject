import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePlanAdminController } from './workspace-plan.admin.controller';

describe('WorkspacePlanAdminController', () => {
  let controller: WorkspacePlanAdminController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspacePlanAdminController],
    }).compile();

    controller = module.get<WorkspacePlanAdminController>(
      WorkspacePlanAdminController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
