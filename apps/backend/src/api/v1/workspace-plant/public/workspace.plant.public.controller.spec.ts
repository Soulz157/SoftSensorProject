import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacePlantPublicController } from './workspace.plant.public.controller';

describe('WorkspacePlantPublicController', () => {
  let controller: WorkspacePlantPublicController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspacePlantPublicController],
    }).compile();

    controller = module.get<WorkspacePlantPublicController>(
      WorkspacePlantPublicController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
