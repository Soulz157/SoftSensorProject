import { Module } from '@nestjs/common';
import { WorkspacePlanPublicController } from './public/workspace-plan.public.controller';
import { WorkspacePlanPublicService } from './public/workspace-plan.public.service';
import { WorkspacePlanAuthorizedController } from './authorized/workspace-plan.authorized.controller';
import { WorkspacePlanAuthorizedService } from './authorized/workspace-plan.authorized.service';
import { WorkspacePlanAdminController } from './admin/workspace-plan.admin.controller';
import { WorkspacePlanAdminService } from './admin/workspace-plan.admin.service';

@Module({
  controllers: [
    WorkspacePlanPublicController,
    WorkspacePlanAuthorizedController,
    WorkspacePlanAdminController,
  ],
  providers: [
    WorkspacePlanPublicService,
    WorkspacePlanAuthorizedService,
    WorkspacePlanAdminService,
  ],
})
export class WorkspacePlanModule {}
