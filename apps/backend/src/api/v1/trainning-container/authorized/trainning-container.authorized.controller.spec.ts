import { Test, TestingModule } from '@nestjs/testing';
import { TrainningContainerAuthorizedController } from './trainning-container.authorized.controller';

describe('TrainningContainerAuthorizedController', () => {
  let controller: TrainningContainerAuthorizedController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrainningContainerAuthorizedController],
    }).compile();

    controller = module.get<TrainningContainerAuthorizedController>(
      TrainningContainerAuthorizedController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
