import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePlantAdminController } from './workspace.plant.admin.controller';

describe('WorkspacePlantAdminController', () => {
  let controller: WorkspacePlantAdminController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspacePlantAdminController],
    }).compile();

    controller = module.get<WorkspacePlantAdminController>(
      WorkspacePlantAdminController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
