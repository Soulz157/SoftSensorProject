import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePlantAuthorizedController } from './workspace.plant.authorized.controller';

describe('WorkspacePlantAuthorizedController', () => {
  let controller: WorkspacePlantAuthorizedController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspacePlantAuthorizedController],
    }).compile();

    controller = module.get<WorkspacePlantAuthorizedController>(
      WorkspacePlantAuthorizedController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
