import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/guards/jwt-auth.guard';
import { AuthAuthorizedService } from './auth.authorized.service';
import { Users } from 'src/common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('authorized/auth')
export class AuthAuthorizedController {
  constructor(private readonly authAuthorizedService: AuthAuthorizedService) {}

  @Get('profile')
  getProfile(@Users() user: { id: string }) {
    return this.authAuthorizedService.getProfile(user.id);
  }
}
