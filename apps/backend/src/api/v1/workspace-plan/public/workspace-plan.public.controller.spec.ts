import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePlanPublicController } from './workspace-plan.public.controller';

describe('WorkspacePlanPublicController', () => {
  let controller: WorkspacePlanPublicController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspacePlanPublicController],
    }).compile();

    controller = module.get<WorkspacePlanPublicController>(
      WorkspacePlanPublicController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
