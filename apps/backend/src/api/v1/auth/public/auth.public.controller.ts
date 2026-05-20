import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthPublicService } from './auth.public.service';
import {
  LoginRequestDto,
  LoginResponseDto,
  RefreshResponseDto,
  RegisterRequestDto,
  RegisterResponseDto,
} from './dto/auth.public.dto';
import { ResponseFailedDto } from 'src/lib/dto';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60,
};

@Controller('public/auth')
@ApiTags('Public Authentication')
export class AuthPublicController {
  constructor(private readonly authPublicService: AuthPublicService) {}

  @Post('register')
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
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiOkResponse({ type: LoginResponseDto, description: 'Login successful' })
  @ApiBadRequestResponse({
    type: ResponseFailedDto,
    description: 'Invalid credentials',
  })
  async loginController(
    @Body() args: LoginRequestDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { response, refreshToken } =
      await this.authPublicService.loginService(args, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    reply.setCookie('refresh_token', refreshToken, COOKIE_OPTIONS);
    return response;
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate refresh token and issue new access token' })
  @ApiOkResponse({ type: RefreshResponseDto, description: 'Token refreshed' })
  @ApiUnauthorizedResponse({
    type: ResponseFailedDto,
    description: 'Refresh token invalid or expired',
  })
  async refreshController(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = req.cookies?.['refresh_token'] ?? '';
    const { response, refreshToken } =
      await this.authPublicService.refreshService(token);
    reply.setCookie('refresh_token', refreshToken, COOKIE_OPTIONS);
    return response;
  }
}
