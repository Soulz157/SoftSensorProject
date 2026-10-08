import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { NotificationChannelAuthorizedService } from './notification-channel.authorized.service';
import {
  CreateNotificationChannelDto,
  UpdateNotificationChannelDto,
} from './dto/notification-channel.authorized.dto';

/**
 * MODEL-SERVE-022-T04. `authorized/workspace/:workspaceId`, matching the
 * existing workspace-scoped prefix convention.
 */
@Controller('authorized/workspace/:workspaceId/notification-channel')
@UseGuards(JwtAccessGuard)
export class NotificationChannelAuthorizedController {
  constructor(private readonly service: NotificationChannelAuthorizedService) {}

  @Get()
  listController(
    @Param('workspaceId') workspaceId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.listChannelsService(workspaceId, user);
  }

  @Post()
  createController(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateNotificationChannelDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.createChannelService(workspaceId, dto, user);
  }

  @Patch(':channelId')
  updateController(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Body() dto: UpdateNotificationChannelDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.updateChannelService(workspaceId, channelId, dto, user);
  }

  @Delete(':channelId')
  deleteController(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.deleteChannelService(workspaceId, channelId, user);
  }

  @Post(':channelId/test')
  testController(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.sendTestMessageService(workspaceId, channelId, user);
  }

  @Get(':channelId/deliveries')
  deliveriesController(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.listDeliveriesService(
      workspaceId,
      channelId,
      user,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
  }
}
