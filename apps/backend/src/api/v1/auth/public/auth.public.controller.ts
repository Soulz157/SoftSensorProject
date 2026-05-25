import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { REFRESH_TOKEN_COOKIE } from '@/config/cookie.config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthPublicService } from './auth.public.service';
import {
  ForgotPasswordRequestDto,
  ForgotPasswordResponseDto,
  LoginRequestDto,
  LoginResponseDto,
  OAuthLoginRequestDto,
  OAuthLoginResponseDto,
  RegisterRequestDto,
  RegisterResponseDto,
  ResetPasswordRequestDto,
  ResetPasswordResponseDto,
} from './dto/auth.public.dto';
import { ResponseFailedDto } from 'src/lib/dto';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
@Controller('public/auth')
@ApiTags('Public Authentication')
export class AuthPublicController {
  constructor(private readonly authPublicService: AuthPublicService) {}

  @Post('register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register new user' })
  @ApiOkResponse({
    type: RegisterResponseDto,
    description: 'Registration successful',
  })
  @ApiBadRequestResponse({
    type: ResponseFailedDto,
    description: 'Registration failed',
  })
  async registerController(@Body() args: RegisterRequestDto) {
    return this.authPublicService.registerService(args);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiOkResponse({ type: LoginResponseDto, description: 'Login successful' })
  @ApiBadRequestResponse({
    type: ResponseFailedDto,
    description: 'Invalid credentials',
  })
  async loginController(
    @Body() args: LoginRequestDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { response, refreshToken } =
      await this.authPublicService.loginService(args, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    res.setCookie('refresh_token', refreshToken, REFRESH_TOKEN_COOKIE);
    return response;
  }

  @Post('OAuth/login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login with OAuth provider' })
  @ApiOkResponse({
    type: OAuthLoginResponseDto,
    description: 'Login successful',
  })
  @ApiBadRequestResponse({
    type: ResponseFailedDto,
    description: 'OAuth login failed',
  })
  async oauthLoginController(
    @Body() args: OAuthLoginRequestDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { response, refreshToken } =
      await this.authPublicService.oauthLoginService(args, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    res.setCookie('refresh_token', refreshToken, REFRESH_TOKEN_COOKIE);
    return response;
  }

  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Initiate password reset process' })
  @ApiOkResponse({
    type: ForgotPasswordResponseDto,
    description: 'Password reset email sent if the email exists',
  })
  async forgotPasswordController(@Body() body: ForgotPasswordRequestDto) {
    return this.authPublicService.forgotPasswordService(body.email);
  }

  @Post('change-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change current user password' })
  @ApiOkResponse({
    type: ResetPasswordResponseDto,
    description: 'Password changed successfully',
  })
  async changePasswordController(@Body() body: ResetPasswordRequestDto) {
    return this.authPublicService.changePasswordService(body);
  }
}
