import { Test, TestingModule } from '@nestjs/testing';
import { MailAdminController } from './mail.admin.controller';

describe('MailAdminController', () => {
  let controller: MailAdminController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MailAdminController],
    }).compile();

    controller = module.get<MailAdminController>(MailAdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
