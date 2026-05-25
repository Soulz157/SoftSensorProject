import { Test, TestingModule } from '@nestjs/testing';
import { MailAuthorizedController } from './mail.authorized.controller';

describe('MailAuthorizedController', () => {
  let controller: MailAuthorizedController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MailAuthorizedController],
    }).compile();

    controller = module.get<MailAuthorizedController>(MailAuthorizedController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
