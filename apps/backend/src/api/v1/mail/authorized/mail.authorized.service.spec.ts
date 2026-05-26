import { Test, TestingModule } from '@nestjs/testing';
import { MailAuthorizedService } from './mail.authorized.service';
import { MailerService } from '@nestjs-modules/mailer';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

jest.mock('@nestjs-modules/mailer', () => ({
  MailerService: class MailerService {},
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MailAuthorizedService', () => {
  let service: MailAuthorizedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailAuthorizedService,
        {
          provide: MailerService,
          useValue: {
            sendMail: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<MailAuthorizedService>(MailAuthorizedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
