import { Test, TestingModule } from '@nestjs/testing';
import { AuthPublicController } from './auth.public.controller';
import { AuthPublicService } from './auth.public.service';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

jest.mock('@softsensor/common', () => ({
  AppException: class AppException extends Error {
    readonly statusCode: number;
    readonly type: string;

    constructor(body: { statusCode: number; message: string; type: string }) {
      super(body.message);
      this.statusCode = body.statusCode;
      this.type = body.type;
    }
  },
}));

jest.mock('@softsensor/prisma', () => ({
  PrismaService: class {},
  PrismaEnums: { Role: { USER: 'USER', ADMIN: 'ADMIN' } },
}));

jest.mock('@/config/cookie.config', () => ({
  REFRESH_TOKEN_COOKIE: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/v1/authorized/auth/refresh',
  },
}));

jest.mock('@nestjs/swagger', () => ({
  ApiTags: () => jest.fn(),
  ApiOperation: () => jest.fn(),
  ApiOkResponse: () => jest.fn(),
  ApiBadRequestResponse: () => jest.fn(),
}));

jest.mock('src/lib/dto', () => ({
  ResponseFailedDto: class ResponseFailedDto {},
}));

jest.mock('./dto/auth.public.dto', () => ({
  RegisterRequestDto: class RegisterRequestDto {},
  RegisterResponseDto: class RegisterResponseDto {},
  LoginRequestDto: class LoginRequestDto {},
  LoginResponseDto: class LoginResponseDto {},
  OAuthLoginRequestDto: class OAuthLoginRequestDto {},
  OAuthLoginResponseDto: class OAuthLoginResponseDto {},
  ForgotPasswordRequestDto: class ForgotPasswordRequestDto {},
  ForgotPasswordResponseDto: class ForgotPasswordResponseDto {},
  ResetPasswordRequestDto: class ResetPasswordRequestDto {},
  ResetPasswordResponseDto: class ResetPasswordResponseDto {},
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthPublicController', () => {
  let controller: AuthPublicController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthPublicController],
      providers: [
        {
          provide: AuthPublicService,
          useValue: {
            registerService: jest.fn(),
            loginService: jest.fn(),
            oauthLoginService: jest.fn(),
            forgotPasswordService: jest.fn(),
            changePasswordService: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthPublicController>(AuthPublicController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
