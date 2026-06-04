import { Test, TestingModule } from '@nestjs/testing';
import { NodesAuthorizedController } from './nodes.authorized.controller';

describe('NodesAuthorizedController', () => {
  let controller: NodesAuthorizedController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NodesAuthorizedController],
    }).compile();

    controller = module.get<NodesAuthorizedController>(
      NodesAuthorizedController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
