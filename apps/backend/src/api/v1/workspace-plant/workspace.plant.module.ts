import { Module } from '@nestjs/common';
import { WorkspacePlantPublicController } from './public/workspace.plant.public.controller';
import { WorkspacePlantPublicService } from './public/workspace.plant.public.service';
import { WorkspacePlantAuthorizedController } from './authorized/workspace.plant.authorized.controller';
import { WorkspacePlantAuthorizedService } from './authorized/workspace.plant.authorized.service';
import { WorkspacePlantAdminController } from './admin/workspace.plant.admin.controller';
import { WorkspacePlantAdminService } from './admin/workspace.plant.admin.service';

@Module({
  controllers: [
    WorkspacePlantPublicController,
    WorkspacePlantAuthorizedController,
    WorkspacePlantAdminController,
  ],
  providers: [
    WorkspacePlantPublicService,
    WorkspacePlantAuthorizedService,
    WorkspacePlantAdminService,
  ],
})
export class WorkspacePlantModule {}
