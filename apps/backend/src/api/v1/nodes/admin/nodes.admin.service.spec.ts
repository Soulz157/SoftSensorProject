import { Test, TestingModule } from '@nestjs/testing';
import { NodesAdminService } from './nodes.admin.service';

describe('NodesAdminService', () => {
  let service: NodesAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NodesAdminService],
    }).compile();

    service = module.get<NodesAdminService>(NodesAdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
