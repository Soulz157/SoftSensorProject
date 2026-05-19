import { Module } from '@nestjs/common';
import { AuthPublicController } from './public/auth.public.controller';
import { AuthPublicService } from './public/auth.public.service';
import { AuthAuthorizedController } from './authorized/auth.authorized.controller';
import { AuthAuthorizedService } from './authorized/auth.authorized.service';

@Module({
  imports: [],
  controllers: [AuthPublicController, AuthAuthorizedController],
  providers: [AuthPublicService, AuthAuthorizedService],
})
export class AuthModule {}
