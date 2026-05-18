import { Test, TestingModule } from '@nestjs/testing';
import { AuthAuthorizedController } from './auth-authorized.controller';

describe('AuthAuthorizedController', () => {
  let controller: AuthAuthorizedController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthAuthorizedController],
    }).compile();

    controller = module.get<AuthAuthorizedController>(AuthAuthorizedController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
