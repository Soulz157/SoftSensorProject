import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkspaceAuthorizedService } from './workspace.authorized.service';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';

@Controller('authorized/workspace')
@ApiTags('Authorized Workspace')
export class WorkspaceAuthorizedController {
  constructor(
    private readonly workspaceAuthorizedService: WorkspaceAuthorizedService,
  ) {}

  @Get('/')
  @HttpCode(200)
  @UseGuards(JwtAccessGuard)
  async getAllWorkspaces(@Users() user: Auth.UserPayload) {
    return this.workspaceAuthorizedService.getAllWorkspaces(user);
  }

  @Get('/:id')
  @HttpCode(200)
  @UseGuards(JwtAccessGuard)
  async getWorkspaceById(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspaceAuthorizedService.getWorkspaceById(id, user);
  }
}
