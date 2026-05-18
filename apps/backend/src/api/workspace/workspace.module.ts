import { Module } from '@nestjs/common';
import { WorkspacePublicController } from './public/workspace-public.controller';
import { WorkspacePublicService } from './public/workspace-public.service';
import { WorkspaceAuthorizedController } from './authorized/workspace-authorized.controller';
import { WorkspaceAuthorizedService } from './authorized/workspace-authorized.service';
import { WorkspaceAdminController } from './admin/workspace-admin.controller';
import { WorkspaceAdminService } from './admin/workspace-admin.service';

@Module({
  controllers: [
    WorkspacePublicController,
    WorkspaceAuthorizedController,
    WorkspaceAdminController,
  ],
  providers: [
    WorkspacePublicService,
    WorkspaceAuthorizedService,
    WorkspaceAdminService,
  ],
})
export class WorkspaceModule {}
