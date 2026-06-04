import { Test, TestingModule } from '@nestjs/testing';
import { NodesAdminController } from './nodes.admin.controller';

describe('NodesAdminController', () => {
  let controller: NodesAdminController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NodesAdminController],
    }).compile();

    controller = module.get<NodesAdminController>(NodesAdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
