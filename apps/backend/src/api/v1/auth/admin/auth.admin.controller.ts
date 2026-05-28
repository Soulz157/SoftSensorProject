import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthAdminService } from './auth.admin.service';
import {
  ActivityLogQueryDto,
  ActivityLogResponseDto,
  AdminUserListResponseDto,
  AdminUserQueryDto,
  PaginationQueryDto,
  UpdateUserRoleDto,
  UserStatsResponseDto,
} from './dto/auth.admin.dto';
import { Users } from '@/common/decorators/user.decorator';
import { ResponseFailedDto } from '@/lib/dto';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { RolesGuard } from '@/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';

@ApiBearerAuth()
@ApiTags('Auth Admin')
@Controller({ path: 'auth/admin', version: '1' })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles('ADMIN')
export class AuthAdminController {
  constructor(private readonly authAdminService: AuthAdminService) {}

  @Get('activity-log')
  @ApiOperation({ summary: 'List auth activity log entries (ADMIN)' })
  @ApiOkResponse({
    type: ActivityLogResponseDto,
    description: 'Activity log fetched successfully',
  })
  @ApiBadRequestResponse({
    type: ResponseFailedDto,
    description: 'Failed to fetch activity log',
  })
  async getActivityLog(@Query() query: ActivityLogQueryDto) {
    return this.authAdminService.listActivityLog(query);
  }

  @Get('user-stats')
  @ApiOperation({ summary: 'List users with 7-day login counts (ADMIN)' })
  @ApiOkResponse({
    type: UserStatsResponseDto,
    description: 'User stats fetched successfully',
  })
  @ApiBadRequestResponse({
    type: ResponseFailedDto,
    description: 'Failed to fetch user stats',
  })
  async getUserStats(@Query() query: PaginationQueryDto) {
    return this.authAdminService.listUserStats(query);
  }

  @Get('users')
  @HttpCode(200)
  @ApiOperation({ summary: 'List all users (ADMIN)' })
  @ApiOkResponse({
    type: AdminUserListResponseDto,
    description: 'Users fetched successfully',
  })
  async listUsers(@Query() query: AdminUserQueryDto) {
    return this.authAdminService.listUsers(query);
  }

  @Patch('users/:id/role')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update user role (ADMIN)' })
  async updateUserRole(
    @Users() actor: Auth.UserPayload,
    @Param('id') id: string,
    @Body() body: UpdateUserRoleDto,
  ) {
    return this.authAdminService.updateUserRole(actor.id, id, body);
  }

  @Patch('users/:id/block')
  @HttpCode(200)
  @ApiOperation({ summary: 'Toggle block/unblock user (ADMIN)' })
  async toggleBlockUser(
    @Users() actor: Auth.UserPayload,
    @Param('id') id: string,
  ) {
    return this.authAdminService.toggleBlockUser(actor.id, id);
  }

  @Delete('users/delete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft-delete user (ADMIN)' })
  async deleteUser(
    @Users() actor: Auth.UserPayload,
    @Body() args: { id: string },
  ) {
    const { id } = args;
    return this.authAdminService.softDeleteUser(actor.id, id);
  }
}
