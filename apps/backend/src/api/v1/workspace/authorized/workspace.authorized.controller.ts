import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkspaceAuthorizedService } from './workspace.authorized.service';
import {
  GetLogsQueryDto,
  InviteMemberDto,
  ReplaceEdgesDto,
  UpdateMemberRoleDto,
} from './dto/workspace.authorized.dto';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { UpdateWorkspaceRequestDto } from '../admin/dto/workspace.admin.dto';

@ApiBearerAuth()
@ApiTags('Authorized Workspace')
@Controller('authorized/workspace')
@UseGuards(JwtAccessGuard)
export class WorkspaceAuthorizedController {
  constructor(
    private readonly workspaceAuthorizedService: WorkspaceAuthorizedService,
  ) {}

  @Get('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'List all workspaces for current user' })
  async getAllWorkspaces(@Users() user: Auth.UserPayload) {
    return this.workspaceAuthorizedService.getAllWorkspaces(user);
  }

  @Get('/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get workspace by ID' })
  async getWorkspaceById(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspaceAuthorizedService.getWorkspaceById(id, user);
  }

  @Get('/:id/models')
  @HttpCode(200)
  @ApiOperation({ summary: 'List models in a workspace' })
  async getWorkspaceModels(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspaceAuthorizedService.getWorkspaceModels(
      id,
      user.id,
      user.role,
    );
  }

  @Get('/:id/edges')
  @HttpCode(200)
  @ApiOperation({ summary: 'List edges in a workspace' })
  async listEdges(@Param('id') id: string, @Users() user: Auth.UserPayload) {
    return this.workspaceAuthorizedService.listEdges(id, user.id, user.role);
  }

  @Put('/:id/edges')
  @HttpCode(200)
  @ApiOperation({ summary: 'Replace all edges in a workspace' })
  async replaceEdges(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
    @Body() body: ReplaceEdgesDto,
  ) {
    return this.workspaceAuthorizedService.replaceEdges(
      id,
      user.id,
      user.role,
      body.edges,
    );
  }

  @Get('/:id/logs')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get activity logs for a workspace' })
  async getWorkspaceLogs(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
    @Query() query: GetLogsQueryDto,
  ) {
    return this.workspaceAuthorizedService.getWorkspaceLogs(
      id,
      user.id,
      user.role,
      query,
    );
  }

  @Get('/:id/members')
  @HttpCode(200)
  @ApiOperation({ summary: 'List members of a workspace' })
  async listMembers(@Param('id') id: string, @Users() user: Auth.UserPayload) {
    return this.workspaceAuthorizedService.listMembers(id, user.id, user.role);
  }

  @Post('/:id/members')
  @HttpCode(201)
  @ApiOperation({ summary: 'Invite a member to a workspace' })
  async inviteMember(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
    @Body() body: InviteMemberDto,
  ) {
    return this.workspaceAuthorizedService.inviteMember(id, user.id, body);
  }

  @Patch('/:id/members/:mid')
  @HttpCode(200)
  @ApiOperation({ summary: "Update a member's role" })
  async updateMemberRole(
    @Param('id') id: string,
    @Param('mid') mid: string,
    @Users() user: Auth.UserPayload,
    @Body() body: UpdateMemberRoleDto,
  ) {
    return this.workspaceAuthorizedService.updateMemberRole(
      id,
      mid,
      user.id,
      body,
    );
  }

  @Patch('/:id')
  @HttpCode(200)
  async updateWorkspaceController(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
    @Body() args: UpdateWorkspaceRequestDto,
  ) {
    return this.workspaceAuthorizedService.updateWorkspaceService(
      id,
      user,
      args,
    );
  }

  @Post('/:id/thumbnail')
  @HttpCode(200)
  @ApiOperation({ summary: 'Upload workspace thumbnail image' })
  async uploadThumbnail(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.workspaceAuthorizedService.uploadThumbnail(
      id,
      user.id,
      user.role,
      req,
    );
  }

  @Delete('/delete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft-delete a workspace (owner only)' })
  async deleteWorkspace(
    @Users() user: Auth.UserPayload,
    @Body() body: { workspaceId: string },
  ) {
    return this.workspaceAuthorizedService.deleteWorkspace(
      body.workspaceId,
      user.id,
    );
  }

  @Delete('/:id/members/:mid')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a member from a workspace' })
  async removeMember(
    @Param('id') id: string,
    @Param('mid') mid: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspaceAuthorizedService.removeMember(id, mid, user.id);
  }
}
