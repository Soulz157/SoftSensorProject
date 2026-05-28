import { Module } from '@nestjs/common';
import { PlanAuthorizedController } from './authorized/plan.authorized.controller';
import { PlanAuthorizedService } from './authorized/plan.authorized.service';
import { PlanAdminController } from './admin/plan.admin.controller';
import { PlanAdminService } from './admin/plan.admin.service';

@Module({
  controllers: [PlanAuthorizedController, PlanAdminController],
  providers: [PlanAuthorizedService, PlanAdminService],
})
export class PlanModule {}
