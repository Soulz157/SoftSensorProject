import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { env } from '@/config/env.config';

/**
 * MODEL-SERVE-022-T02-addendum. Events are history in Postgres, so they are
 * bounded — same rule MODEL-SERVE-008-T02 states: "a rate and its retention
 * are decided together." Own sweep, same `.unref()` shape as every other
 * sweep in this feature; deletes `NotificationEvent` rows older than
 * `NOTIFY_EVENT_RETENTION_DAYS` (user decision, 2026-09-29: 90). Deliveries
 * cascade with their event (schema `onDelete: Cascade`); nothing else reads
 * a deleted event, since the bell always queries live rows.
 */
@Injectable()
export class NotificationRetentionService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly log = new Logger(NotificationRetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (env.NOTIFY_RETENTION_SWEEP_INTERVAL_MS <= 0) {
      this.log.log('notification retention sweep disabled (interval <= 0)');
      return;
    }
    this.timer = setInterval(
      () => void this.sweep(),
      env.NOTIFY_RETENTION_SWEEP_INTERVAL_MS,
    ).unref();
    this.log.log(
      `notification retention sweep scheduled every ${env.NOTIFY_RETENTION_SWEEP_INTERVAL_MS}ms, retaining ${env.NOTIFY_EVENT_RETENTION_DAYS}d`,
    );
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      if (env.NOTIFY_EVENT_RETENTION_DAYS <= 0) return;
      const cutoff = new Date(
        Date.now() - env.NOTIFY_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const result = await this.prisma.notificationEvent.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (result.count > 0) {
        this.log.log(`retention sweep deleted ${result.count} event(s)`);
      }
    } catch (err) {
      this.log.warn(`retention sweep failed: ${(err as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }
}
