import { Module } from '@nestjs/common';
import { NotificationCoreModule } from './core/notification-core.module';
import { NotificationChannelAuthorizedController } from './authorized/notification-channel.authorized.controller';
import { NotificationChannelAuthorizedService } from './authorized/notification-channel.authorized.service';
import { NotificationFeedAuthorizedController } from './authorized/notification-feed.authorized.controller';
import { NotificationFeedAuthorizedService } from './authorized/notification-feed.authorized.service';

/**
 * MODEL-SERVE-022-T04/T07. The public API module — registered in
 * `app.module.ts` like every other feature module. `NotificationCoreModule`
 * gives it `NotificationDeliveryService` (for "send test notification")
 * without re-registering the sweep a second time (Nest instantiates a
 * given provider class once regardless of how many modules import the
 * module that provides it) — the retention sweep it also now carries
 * (T02 addendum) needs nothing from this module directly.
 */
@Module({
  imports: [NotificationCoreModule],
  controllers: [
    NotificationChannelAuthorizedController,
    NotificationFeedAuthorizedController,
  ],
  providers: [
    NotificationChannelAuthorizedService,
    NotificationFeedAuthorizedService,
  ],
})
export class NotificationModule {}
