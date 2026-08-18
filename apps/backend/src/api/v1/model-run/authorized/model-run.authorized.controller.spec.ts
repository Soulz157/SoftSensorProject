import { Test, TestingModule } from '@nestjs/testing';
import { ModelRunAuthorizedController } from './model-run.authorized.controller';

describe('ModelRunAuthorizedController', () => {
  let controller: ModelRunAuthorizedController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModelRunAuthorizedController],
    }).compile();

    controller = module.get<ModelRunAuthorizedController>(
      ModelRunAuthorizedController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
