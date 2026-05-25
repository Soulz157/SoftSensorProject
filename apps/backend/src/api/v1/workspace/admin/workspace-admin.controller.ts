import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceAdminService } from './workspace-admin.service';
import { Users } from '@/common/decorators/user.decorator';
import { ApiBadRequestResponse, ApiOkResponse } from '@nestjs/swagger';
import { ResponseFailedDto } from '@/lib/dto';
import {
  CreateWorkspaceRequestDto,
  CreateWorkspaceResponseDto,
  DeleteWorkspaceRequestDto,
  DeleteWorkspaceResponseDto,
  UpdateWorkspaceRequestDto,
} from './dto/workspace.admin.dto';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { RolesGuard } from '@/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';

@Controller('admin/workspace')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles('USER', 'ADMIN')
export class WorkspaceAdminController {
  constructor(private readonly workspaceAdminService: WorkspaceAdminService) {}

  @Post('/create')
  @HttpCode(201)
  @ApiOkResponse({
    type: CreateWorkspaceResponseDto,
    description: 'Workspace created successfully',
  })
  @ApiBadRequestResponse({
    type: ResponseFailedDto,
    description: 'Failed to create workspace',
  })
  async createWorkspace(
    @Users() user: Auth.UserPayload,
    @Body() args: CreateWorkspaceRequestDto,
  ) {
    return await this.workspaceAdminService.createWorkspace(user, args);
  }

  @Patch('/:id')
  @HttpCode(200)
  async updateWorkspace(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
    @Body() args: UpdateWorkspaceRequestDto,
  ) {
    return this.workspaceAdminService.updateWorkspace(id, user, args);
  }

  @Delete('/delete')
  @HttpCode(200)
  @ApiOkResponse({
    type: DeleteWorkspaceResponseDto,
    description: 'Workspace deleted successfully',
  })
  @ApiBadRequestResponse({
    type: ResponseFailedDto,
    description: 'Failed to delete workspace',
  })
  async deleteWorkspace(
    @Users() user: Auth.UserPayload,
    @Body() args: DeleteWorkspaceRequestDto,
  ) {
    return await this.workspaceAdminService.deleteWorkspace(user, args);
  }
}
