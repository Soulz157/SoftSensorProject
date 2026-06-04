import { Test, TestingModule } from '@nestjs/testing';
import { NodesPublicService } from './nodes.public.service';

describe('NodesPublicService', () => {
  let service: NodesPublicService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NodesPublicService],
    }).compile();

    service = module.get<NodesPublicService>(NodesPublicService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
