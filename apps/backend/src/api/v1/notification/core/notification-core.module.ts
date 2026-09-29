import { Module } from '@nestjs/common';
import { NotificationOutboxService } from './notification-outbox.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationRetentionService } from './notification-retention.service';

/**
 * MODEL-SERVE-022. A LEAF module — imports NOTHING from any other feature
 * module, so every write-site module (model-version, model-run,
 * inference-window) and the top-level channel-API module can import THIS
 * without ever closing a cycle. `PrismaService` is `@Global` and
 * `MailerService` is registered global by `MailerModule.forRoot` in
 * `app.module.ts`, so neither needs importing here.
 *
 * `NotificationRetentionService` (T02 addendum) is self-driving, like
 * `NotificationDeliveryService` — a provider here, never exported, since
 * nothing calls it directly.
 */
@Module({
  providers: [
    NotificationOutboxService,
    NotificationDeliveryService,
    NotificationRetentionService,
  ],
  exports: [NotificationOutboxService, NotificationDeliveryService],
})
export class NotificationCoreModule {}
