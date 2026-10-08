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
  AdminWorkspaceSummaryResponseDto,
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
// ADMIN is enforced per route, not on the class: `POST /create` is the
// onboarding path every USER takes (create-workspace-form → workspaceService
// .createWorkspace), so a class-level @Roles('ADMIN') would lock new users
// out of creating their first workspace.
@UseGuards(JwtAccessGuard, RolesGuard)
export class WorkspaceAdminController {
  constructor(private readonly workspaceAdminService: WorkspaceAdminService) {}

  @Roles('ADMIN')
  @Get('/')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminWorkspaceListResponseDto })
  async listWorkspaces(@Query() query: AdminWorkspaceQueryDto) {
    return this.workspaceAdminService.listWorkspaces(query);
  }

  // Declared BEFORE `/:id` — otherwise "summary" is read as a workspace id.
  @Roles('ADMIN')
  @Get('/summary')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminWorkspaceSummaryResponseDto })
  async getSummary() {
    return this.workspaceAdminService.getSummary();
  }

  @Roles('ADMIN')
  @Get('/:id')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminGetWorkspaceByIdResponseDto })
  async getWorkspaceById(@Param('id') id: string) {
    return this.workspaceAdminService.getWorkspaceById(id);
  }

  // Intentionally open to any authenticated user — see the class comment.
  // TODO: move to the authorized workspace controller.
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

  @Roles('ADMIN')
  @Patch('/:id')
  @HttpCode(200)
  async updateWorkspace(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
    @Body() args: UpdateWorkspaceRequestDto,
  ) {
    return this.workspaceAdminService.updateWorkspace(id, user, args);
  }

  @Roles('ADMIN')
  @Post('/:id/members')
  @HttpCode(201)
  async inviteMember(
    @Param('id') id: string,
    @Body() body: AdminInviteMemberDto,
  ) {
    return this.workspaceAdminService.inviteMember(id, body);
  }

  @Roles('ADMIN')
  @Patch('/:id/members/:mid')
  @HttpCode(200)
  async updateMemberRole(
    @Param('id') id: string,
    @Param('mid') mid: string,
    @Body() body: AdminUpdateMemberRoleDto,
  ) {
    return this.workspaceAdminService.updateMemberRole(id, mid, body);
  }

  @Roles('ADMIN')
  @Patch('/:id/members/:mid/move')
  @HttpCode(200)
  async moveMember(
    @Param('id') id: string,
    @Param('mid') mid: string,
    @Body() body: AdminMoveMemberDto,
  ) {
    return this.workspaceAdminService.moveMember(id, mid, body);
  }

  @Roles('ADMIN')
  @Delete('/:id/members/:mid')
  @HttpCode(200)
  async removeMember(@Param('id') id: string, @Param('mid') mid: string) {
    return this.workspaceAdminService.removeMember(id, mid);
  }

  @Roles('ADMIN')
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
