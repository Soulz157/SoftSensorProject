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
import { WorkspaceAdminService } from './workspace.admin.service';
import { Users } from '@/common/decorators/user.decorator';
import { ApiBadRequestResponse, ApiOkResponse } from '@nestjs/swagger';
import { ResponseFailedDto } from '@/lib/dto';
import {
  AdminGetWorkspaceByIdResponseDto,
  AdminInviteMemberDto,
  AdminMoveMemberDto,
  AdminUpdateMemberRoleDto,
  AdminWorkspaceListResponseDto,
  AdminWorkspaceQueryDto,
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
@Roles('ADMIN')
export class WorkspaceAdminController {
  constructor(private readonly workspaceAdminService: WorkspaceAdminService) {}

  @Get('/')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminWorkspaceListResponseDto })
  async listWorkspaces(@Query() query: AdminWorkspaceQueryDto) {
    return this.workspaceAdminService.listWorkspaces(query);
  }

  @Get('/:id')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminGetWorkspaceByIdResponseDto })
  async getWorkspaceById(@Param('id') id: string) {
    return this.workspaceAdminService.getWorkspaceById(id);
  }

  @Post('/create')
  @HttpCode(201)
  @ApiOkResponse({ type: CreateWorkspaceResponseDto })
  @ApiBadRequestResponse({ type: ResponseFailedDto })
  async createWorkspace(
    @Users() user: Auth.UserPayload,
    @Body() args: CreateWorkspaceRequestDto,
  ) {
    return this.workspaceAdminService.createWorkspace(user, args);
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

  @Post('/:id/members')
  @HttpCode(201)
  async inviteMember(
    @Param('id') id: string,
    @Body() body: AdminInviteMemberDto,
  ) {
    return this.workspaceAdminService.inviteMember(id, body);
  }

  @Patch('/:id/members/:mid')
  @HttpCode(200)
  async updateMemberRole(
    @Param('id') id: string,
    @Param('mid') mid: string,
    @Body() body: AdminUpdateMemberRoleDto,
  ) {
    return this.workspaceAdminService.updateMemberRole(id, mid, body);
  }

  @Patch('/:id/members/:mid/move')
  @HttpCode(200)
  async moveMember(
    @Param('id') id: string,
    @Param('mid') mid: string,
    @Body() body: AdminMoveMemberDto,
  ) {
    return this.workspaceAdminService.moveMember(id, mid, body);
  }

  @Delete('/:id/members/:mid')
  @HttpCode(200)
  async removeMember(@Param('id') id: string, @Param('mid') mid: string) {
    return this.workspaceAdminService.removeMember(id, mid);
  }

  @Delete('/delete')
  @HttpCode(200)
  @ApiOkResponse({ type: DeleteWorkspaceResponseDto })
  @ApiBadRequestResponse({ type: ResponseFailedDto })
  async deleteWorkspace(
    @Users() user: Auth.UserPayload,
    @Body() args: DeleteWorkspaceRequestDto,
  ) {
    return this.workspaceAdminService.deleteWorkspace(user, args);
  }
}
