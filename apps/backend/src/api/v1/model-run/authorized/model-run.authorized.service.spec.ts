import { Test, TestingModule } from '@nestjs/testing';
import { ModelRunAuthorizedService } from './model-run.authorized.service';

describe('ModelRunAuthorizedService', () => {
  let service: ModelRunAuthorizedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ModelRunAuthorizedService],
    }).compile();

    service = module.get<ModelRunAuthorizedService>(ModelRunAuthorizedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
