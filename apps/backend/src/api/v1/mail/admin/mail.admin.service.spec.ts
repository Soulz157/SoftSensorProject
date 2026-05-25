import { Test, TestingModule } from '@nestjs/testing';
import { MailAdminService } from './mail.admin.service';

describe('MailAdminService', () => {
  let service: MailAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MailAdminService],
    }).compile();

    service = module.get<MailAdminService>(MailAdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
