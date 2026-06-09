import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { WorkspacePlanAuthorizedService } from './workspace-plan.authorized.service';
import {
  CreateWorkspacePlanDto,
  UpdateWorkspacePlanDto,
  WorkspacePlanQueryDto,
  DeleteWorkspacePlanDto,
} from './dto/workspace-plan.authorized.dto';

@ApiBearerAuth()
@ApiTags('Authorized Workspace Plans')
@Controller('authorized/workspace-plan')
@UseGuards(JwtAccessGuard)
export class WorkspacePlanAuthorizedController {
  constructor(
    private readonly workspacePlanAuthorizedService: WorkspacePlanAuthorizedService,
  ) {}

  @Get('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'List all plans for a workspace' })
  async getPlans(
    @Query() query: WorkspacePlanQueryDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspacePlanAuthorizedService.getPlans(query, user.id);
  }

  @Post('/:workspaceId')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new plan in a workspace' })
  async createPlan(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateWorkspacePlanDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspacePlanAuthorizedService.createPlan(
      workspaceId,
      dto,
      user.id,
    );
  }

  @Patch('/:planId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a plan by ID' })
  async updatePlan(
    @Param('planId') planId: string,
    @Body() dto: UpdateWorkspacePlanDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspacePlanAuthorizedService.updatePlan(planId, dto, user.id);
  }

  @Delete('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a plan by ID' })
  async deletePlan(
    @Body() dto: DeleteWorkspacePlanDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspacePlanAuthorizedService.deletePlan(dto, user.id);
  }
}
