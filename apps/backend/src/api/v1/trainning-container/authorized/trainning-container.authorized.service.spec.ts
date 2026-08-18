import { Test, TestingModule } from '@nestjs/testing';
import { TrainningContainerAuthorizedService } from './trainning-container.authorized.service';

describe('TrainningContainerAuthorizedService', () => {
  let service: TrainningContainerAuthorizedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TrainningContainerAuthorizedService],
    }).compile();

    service = module.get<TrainningContainerAuthorizedService>(
      TrainningContainerAuthorizedService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
