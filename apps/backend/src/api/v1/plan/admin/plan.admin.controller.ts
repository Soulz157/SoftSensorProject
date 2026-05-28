import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PlanAdminService } from './plan.admin.service';
import { AssignPlanDto } from './dto/plan.admin.dto';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { RolesGuard } from '@/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';

@ApiBearerAuth()
@ApiTags('Plan Admin')
@Controller('admin/plan')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles('ADMIN')
export class PlanAdminController {
  constructor(private readonly planAdminService: PlanAdminService) {}

  @Get('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'List all plans (ADMIN)' })
  async listPlans() {
    return this.planAdminService.listPlans();
  }

  @Patch('/user/:userId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Assign plan to user (ADMIN)' })
  @ApiOkResponse({ description: 'Plan assigned successfully' })
  async assignPlan(
    @Param('userId') userId: string,
    @Body() body: AssignPlanDto,
  ) {
    return this.planAdminService.assignPlan(userId, body);
  }
}
