import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { JwtAuthGuard } from 'src/guards/jwt-auth.guard';
import { AuthAuthorizedService } from './auth.authorized.service';
import { Users } from 'src/common/decorators/user.decorator';
import { LogoutResponseDto } from './dto/auth.authorized.dto';
import { ResponseFailedDto } from 'src/lib/dto';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Authorized Authentication')
@Controller('authorized/auth')
export class AuthAuthorizedController {
  constructor(private readonly authAuthorizedService: AuthAuthorizedService) {}

  @Post('logout')
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
    reply.clearCookie('refresh_token', { path: '/' });
    return result;
  }
}
