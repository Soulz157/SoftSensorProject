import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePlanAuthorizedController } from './workspace-plan.authorized.controller';

describe('WorkspacePlanAuthorizedController', () => {
  let controller: WorkspacePlanAuthorizedController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspacePlanAuthorizedController],
    }).compile();

    controller = module.get<WorkspacePlanAuthorizedController>(
      WorkspacePlanAuthorizedController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
