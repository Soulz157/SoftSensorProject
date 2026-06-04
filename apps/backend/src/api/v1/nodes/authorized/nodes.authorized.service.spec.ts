import { Test, TestingModule } from '@nestjs/testing';
import { NodesAuthorizedService } from './nodes.authorized.service';

describe('NodesAuthorizedService', () => {
  let service: NodesAuthorizedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NodesAuthorizedService],
    }).compile();

    service = module.get<NodesAuthorizedService>(NodesAuthorizedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
