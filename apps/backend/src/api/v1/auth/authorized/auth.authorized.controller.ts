import {
  Controller,
  Get,
  HttpCode,
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
  @UseGuards(JwtAccessGuard)
  @ApiOperation({ summary: 'Get current user information' })
  @ApiOkResponse({
    type: GetMeResponseDto,
    description: 'User information retrieved successfully',
  })
  async getMeController(@Users() user: Auth.UserPayload) {
    return this.authAuthorizedService.getMeService(user.id);
  }

  @Post('logout')
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
