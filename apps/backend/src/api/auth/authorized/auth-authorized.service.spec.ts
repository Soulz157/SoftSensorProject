import { Test, TestingModule } from '@nestjs/testing';
import { AuthAuthorizedService } from './auth-authorized.service';

describe('AuthAuthorizedService', () => {
  let service: AuthAuthorizedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthAuthorizedService],
    }).compile();

    service = module.get<AuthAuthorizedService>(AuthAuthorizedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
