import { Test, TestingModule } from '@nestjs/testing';
import { AuthPublicService } from './auth-public.service';

describe('AuthPublicService', () => {
  let service: AuthPublicService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthPublicService],
    }).compile();

    service = module.get<AuthPublicService>(AuthPublicService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
