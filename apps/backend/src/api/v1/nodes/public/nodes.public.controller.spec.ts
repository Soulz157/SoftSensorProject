import { Test, TestingModule } from '@nestjs/testing';
import { NodesPublicController } from './nodes.public.controller';

describe('NodesPublicController', () => {
  let controller: NodesPublicController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NodesPublicController],
    }).compile();

    controller = module.get<NodesPublicController>(NodesPublicController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
