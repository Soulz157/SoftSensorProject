import { Module } from '@nestjs/common';
import { WorkspaceAuthorizedController } from './authorized/workspace.authorized.controller';
import { WorkspaceAuthorizedService } from './authorized/workspace.authorized.service';
import { WorkspaceAdminController } from './admin/workspace.admin.controller';
import { WorkspaceAdminService } from './admin/workspace.admin.service';
import { WorkspaceDataIntakeAuthorizedService } from './authorized/workspace-data-intake.authorized.service';

@Module({
  controllers: [WorkspaceAuthorizedController, WorkspaceAdminController],
  providers: [
    WorkspaceAuthorizedService,
    WorkspaceAdminService,
    WorkspaceDataIntakeAuthorizedService,
  ],
})
export class WorkspaceModule {}
