import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PlanAdminService } from './plan.admin.service';
import { AssignPlanDto, CreatePlanDto } from './dto/plan.admin.dto';
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

  @Post('/')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new plan (ADMIN)' })
  @ApiOkResponse({ description: 'Plan created successfully' })
  async createPlaController(@Body() body: CreatePlanDto) {
    return this.planAdminService.createPlanService(body);
  }

  @Get('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'List all plans (ADMIN)' })
  async listPlansController() {
    return this.planAdminService.listPlansService();
  }

  @Patch('/user/:userId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Assign plan to user (ADMIN)' })
  @ApiOkResponse({ description: 'Plan assigned successfully' })
  async assignPlanController(
    @Param('userId') userId: string,
    @Body() body: AssignPlanDto,
  ) {
    return this.planAdminService.assignPlanService(userId, body);
  }
}
