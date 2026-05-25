import { Module } from '@nestjs/common';
import { MailAuthorizedController } from './authorized/mail.authorized.controller';
import { MailAuthorizedService } from './authorized/mail.authorized.service';
import { MailAdminController } from './admin/mail.admin.controller';
import { MailAdminService } from './admin/mail.admin.service';

@Module({
  controllers: [MailAuthorizedController, MailAdminController],
  providers: [MailAuthorizedService, MailAdminService],
  exports: [MailAuthorizedService],
})
export class MailModule {}
