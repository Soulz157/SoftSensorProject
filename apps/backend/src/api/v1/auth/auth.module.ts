import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthPublicController } from './public/auth.public.controller';
import { AuthPublicService } from './public/auth.public.service';
import { AuthAuthorizedController } from './authorized/auth.authorized.controller';
import { AuthAuthorizedService } from './authorized/auth.authorized.service';
import { JwtAccessStrategy } from '@/strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from '@/strategies/jwt-refresh.strategy';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
    MailModule,
  ],
  controllers: [AuthPublicController, AuthAuthorizedController],
  providers: [
    AuthPublicService,
    AuthAuthorizedService,
    JwtAccessStrategy,
    JwtRefreshStrategy,
  ],
  exports: [AuthAuthorizedService],
})
export class AuthModule {}
