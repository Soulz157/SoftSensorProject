import { Module } from '@nestjs/common';
import { AuthPublicController } from './public/auth-public.controller';
import { AuthPublicService } from './public/auth-public.service';
import { AuthAuthorizedController } from './authorized/auth-authorized.controller';
import { AuthAuthorizedService } from './authorized/auth-authorized.service';
import { AuthAdminController } from './admin/auth-admin.controller';
import { AuthAdminService } from './admin/auth-admin.service';

@Module({
  controllers: [
    AuthPublicController,
    AuthAuthorizedController,
    AuthAdminController,
  ],
  providers: [AuthPublicService, AuthAuthorizedService, AuthAdminService],
})
export class AuthModule {}
