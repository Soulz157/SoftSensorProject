import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { NotificationFeedAuthorizedService } from './notification-feed.authorized.service';
import {
  MarkNotificationsReadDto,
  MuteModelDto,
} from './dto/notification-feed.authorized.dto';

/**
 * MODEL-SERVE-022-T07. `authorized/notifications` — not workspace-scoped in
 * the URL, because a user's feed spans every workspace they can read, the
 * same shape the global Alerts page already uses for its own cross-
 * workspace view.
 */
@Controller('authorized/notifications')
@UseGuards(JwtAccessGuard)
export class NotificationFeedAuthorizedController {
  constructor(private readonly service: NotificationFeedAuthorizedService) {}

  @Get()
  listController(
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.listEventsService(
      user,
      cursor,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('unread-count')
  unreadCountController(@Users() user: Auth.UserPayload) {
    return this.service.unreadCountService(user);
  }

  @Post('read')
  markReadController(
    @Body() dto: MarkNotificationsReadDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.markReadService(user, dto.upTo);
  }

  @Get('mutes')
  listMutesController(@Users() user: Auth.UserPayload) {
    return this.service.listMutesService(user);
  }

  @Post('mutes')
  muteModelController(
    @Body() dto: MuteModelDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.muteModelService(user, dto.modelId);
  }

  @Delete('mutes/:modelId')
  unmuteModelController(
    @Param('modelId') modelId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.unmuteModelService(user, modelId);
  }
}
