import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthPublicController } from './public/auth.public.controller';
import { AuthPublicService } from './public/auth.public.service';
import { AuthAuthorizedController } from './authorized/auth.authorized.controller';
import { AuthAuthorizedService } from './authorized/auth.authorized.service';
import { JwtStrategy } from 'src/strategies/jwt.strategy';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [AuthPublicController, AuthAuthorizedController],
  providers: [AuthPublicService, AuthAuthorizedService, JwtStrategy],
})
export class AuthModule {}
