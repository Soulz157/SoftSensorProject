import { Test, TestingModule } from '@nestjs/testing';
import { MailAuthorizedService } from './mail.authorized.service';

describe('MailAuthorizedService', () => {
  let service: MailAuthorizedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MailAuthorizedService],
    }).compile();

    service = module.get<MailAuthorizedService>(MailAuthorizedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
