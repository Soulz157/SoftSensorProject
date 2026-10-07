import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { PrismaService, PrismaModels } from '@softsensor/prisma';
import { env } from '@/config/env.config';
import { decryptSecret } from '@/lib/crypto';
import { redactUrls } from '@/lib/redact-urls';
import {
  renderEmail,
  renderTeamsCard,
  type RenderedMessage,
} from '@/lib/notification-message';

/** `digest` is absent on every payload written before MODEL-SERVE-031 and
 *  on every non-digest event — the renderers fall back to `bodyText`. */
type StoredPayload = RenderedMessage;

/**
 * MODEL-SERVE-022-D04/T04. THE DRAIN — the only place in this feature that
 * actually performs outbound I/O to Teams or SMTP. Own sweep
 * (NOTIFY_DELIVERY_INTERVAL_MS, `<= 0` disables), same `.unref()` shape
 * every sweep in this codebase uses, so a slow or dead endpoint can never
 * delay the evaluator, the scheduler, or a user request (acceptance
 * criterion 8).
 *
 * Claims a row with the SAME compare-and-swap `updateMany` shape
 * `model-candidate-job.authorized.service.ts` already uses for its own
 * concurrent-safe status swaps — a second instance of this service (a
 * horizontally scaled backend) can run the same sweep without double
 * sending, since only one claim of a given row's PENDING->SENDING swap
 * ever succeeds.
 */
@Injectable()
export class NotificationDeliveryService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly log = new Logger(NotificationDeliveryService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  async onModuleInit() {
    // A row a previous process claimed (SENDING) and then crashed before
    // resolving is otherwise stuck forever — reset it to PENDING so the
    // next sweep picks it up again, same recovery shape
    // `reconcileOrphanedRuns` gives a stuck RUNNING window.
    await this.prisma.notificationDelivery.updateMany({
      where: { status: 'SENDING' },
      data: { status: 'PENDING', nextAttemptAt: new Date() },
    });

    if (env.NOTIFY_DELIVERY_INTERVAL_MS <= 0) {
      this.log.log('notification delivery drain disabled (interval <= 0)');
      return;
    }
    this.timer = setInterval(
      () => void this.drain(),
      env.NOTIFY_DELIVERY_INTERVAL_MS,
    ).unref();
    this.log.log(
      `notification delivery drain scheduled every ${env.NOTIFY_DELIVERY_INTERVAL_MS}ms`,
    );
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const due = await this.prisma.notificationDelivery.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: 'asc' },
        take: 25,
        include: { channel: true },
      });
      for (const row of due) {
        try {
          await this.attempt(row);
        } catch (err) {
          this.log.warn(
            `delivery ${row.id} attempt threw unexpectedly: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.log.warn(`delivery drain failed: ${(err as Error).message}`);
    } finally {
      this.draining = false;
    }
  }

  /** Claims one row (PENDING -> SENDING, compare-and-swap) and sends it.
   *  Exposed for the "send test notification" endpoint to call directly,
   *  so a test send goes through the exact same code path the sweep uses
   *  rather than a parallel implementation that could disagree with it. */
  async attempt(
    row: PrismaModels.NotificationDeliveryModel & {
      channel: PrismaModels.NotificationChannelModel;
    },
  ): Promise<void> {
    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status: 'SENDING' },
    });
    if (claimed.count === 0) return; // lost the race to another drain pass.

    try {
      await this.send(row.channel, row.payload as unknown as StoredPayload);
      await this.prisma.notificationDelivery.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    } catch (err) {
      const attempts = row.attempts + 1;
      // redactUrls even here: a fetch/network error message can echo the
      // request URL back verbatim, and lastError is a client-visible field
      // (delivery history) — the webhook URL must never appear in it.
      const lastError = redactUrls((err as Error).message ?? 'send failed');
      if (attempts >= env.NOTIFY_DELIVERY_MAX_ATTEMPTS) {
        await this.prisma.notificationDelivery.update({
          where: { id: row.id },
          data: { status: 'FAILED', attempts, lastError },
        });
        return;
      }
      const backoffMinutes = 2 ** (attempts - 1);
      await this.prisma.notificationDelivery.update({
        where: { id: row.id },
        data: {
          status: 'PENDING',
          attempts,
          lastError,
          nextAttemptAt: new Date(Date.now() + backoffMinutes * 60_000),
        },
      });
    }
  }

  private async send(
    channel: PrismaModels.NotificationChannelModel,
    payload: StoredPayload,
  ): Promise<void> {
    if (channel.kind === 'TEAMS_WORKFLOW') {
      await this.sendTeams(channel, payload);
      return;
    }
    await this.sendEmail(channel, payload);
  }

  private async sendTeams(
    channel: PrismaModels.NotificationChannelModel,
    payload: StoredPayload,
  ): Promise<void> {
    if (!channel.encryptedTarget) {
      throw new Error('channel has no Teams Workflow URL configured');
    }
    const url = decryptSecret(channel.encryptedTarget);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(renderTeamsCard(payload)),
      signal: AbortSignal.timeout(env.NOTIFY_SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      // A non-2xx response is a delivery FAILURE, not a success — the
      // status text never carries the URL, so no redaction needed here.
      throw new Error(`Teams webhook responded ${res.status}`);
    }
  }

  private async sendEmail(
    channel: PrismaModels.NotificationChannelModel,
    payload: StoredPayload,
  ): Promise<void> {
    if (channel.recipientUserIds.length === 0) {
      throw new Error('channel has no recipients configured');
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: channel.recipientUserIds } },
      select: { email: true },
    });
    if (users.length === 0) {
      throw new Error('none of the configured recipients still exist');
    }
    const rendered = renderEmail(payload);
    await withTimeout(
      this.mailer.sendMail({
        to: users.map((u) => u.email),
        subject: payload.title,
        html: rendered.html,
        text: rendered.text,
      }),
      env.NOTIFY_SEND_TIMEOUT_MS,
      'SMTP send timed out',
    );
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
