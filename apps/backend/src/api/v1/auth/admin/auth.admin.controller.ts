import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
  PaginationQueryDto,
  UserStatsResponseDto,
} from './dto/auth.admin.dto';
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
}
