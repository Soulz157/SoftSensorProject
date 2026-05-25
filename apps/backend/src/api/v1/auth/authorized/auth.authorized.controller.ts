import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { JwtAccessGuard } from 'src/guards/jwt-access.guard';
import { AuthAuthorizedService } from './auth.authorized.service';
import { Users } from 'src/common/decorators/user.decorator';
import {
  GetMeResponseDto,
  LogoutResponseDto,
  RefreshResponseDto,
  EditResponseDto,
  EditRequestDto,
  ChangePasswordRequestDto,
  ChangePasswordResponseDto,
} from './dto/auth.authorized.dto';
import { ResponseFailedDto } from 'src/lib/dto';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  REFRESH_TOKEN_COOKIE,
  CLEAR_REFRESH_TOKEN_COOKIE,
} from '@/config/cookie.config';
import { JwtRefreshGuard } from '@/guards/jwt-refresh.guard';

@ApiBearerAuth()
@ApiTags('Authorized Authentication')
@Controller('authorized/auth')
export class AuthAuthorizedController {
  constructor(private readonly authAuthorizedService: AuthAuthorizedService) {}

  @Get('me')
  @HttpCode(200)
  @UseGuards(JwtAccessGuard)
  @ApiOperation({ summary: 'Get current user information' })
  @ApiOkResponse({
    type: GetMeResponseDto,
    description: 'User information retrieved successfully',
  })
  async getMeController(@Users() user: Auth.UserPayload) {
    return this.authAuthorizedService.getMeService(user);
  }

  @Patch('me')
  @HttpCode(200)
  @UseGuards(JwtAccessGuard)
  @ApiOperation({ summary: 'Edit current user information' })
  @ApiOkResponse({
    type: EditResponseDto,
    description: 'User information updated successfully',
  })
  async editMeController(
    @Users() user: Auth.UserPayload,
    @Body() body: EditRequestDto,
  ) {
    return this.authAuthorizedService.editMeService(user.id, body);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAccessGuard)
  @ApiOperation({ summary: 'Change current user password' })
  @ApiOkResponse({
    type: ChangePasswordResponseDto,
    description: 'Password changed successfully',
  })
  async changePasswordController(
    @Users() user: Auth.UserPayload,
    @Body() body: ChangePasswordRequestDto,
  ) {
    return this.authAuthorizedService.changePasswordService(user, body);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAccessGuard)
  @ApiOperation({ summary: 'Logout and invalidate all refresh tokens' })
  @ApiOkResponse({ type: LogoutResponseDto, description: 'Logout successful' })
  @ApiUnauthorizedResponse({ type: ResponseFailedDto })
  async logoutController(
    @Users() user: Auth.UserPayload,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.authAuthorizedService.logoutService(user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    reply.clearCookie('refresh_token', CLEAR_REFRESH_TOKEN_COOKIE);
    return result;
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(JwtRefreshGuard)
  @ApiOperation({ summary: 'Rotate refresh token and issue new access token' })
  @ApiOkResponse({ type: RefreshResponseDto, description: 'Token refreshed' })
  @ApiUnauthorizedResponse({
    type: ResponseFailedDto,
    description: 'Refresh token invalid or expired',
  })
  async refreshController(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const token = req.cookies?.['refresh_token'] ?? '';
    const { response, refreshToken } =
      await this.authAuthorizedService.refreshService(token);
    res.setCookie('refresh_token', refreshToken, REFRESH_TOKEN_COOKIE);
    return response;
  }
}
