import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import {
  buildDigestMessage,
  buildNotificationMessage,
} from '@/lib/notification-message';
import type { DigestData } from '@/lib/notification-digest';

/** Same order every severity comparison in this feature uses — a channel's
 *  `minSeverity` is a FLOOR, so an event ranked below it is silently
 *  dropped for that channel, never queued and never failed. */
const SEVERITY_RANK: Record<string, number> = {
  INFO: 0,
  WARNING: 1,
  CRITICAL: 2,
};

export interface EnqueueParams {
  workspaceId: string;
  modelId: string;
  modelName: string;
  workspaceName: string;
  axis: 'DEPLOY' | 'MONITORING' | null;
  event: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  detail: string;
  rawDetailSuffix?: string | null;
  frozenColumns?: { column: string; flatMinutes: number | null }[];
  at: Date;
  /**
   * MODEL-SERVE-022-T07/D09. The five-word vocabulary
   * (normal/warning/alert/offline/frozen), computed by the CALLER via
   * `lib/notification-monitoring-status.ts` — stored on `NotificationEvent`
   * for the navbar bell. Undefined/null for a discrete event with no axis
   * reading (VERSION_PROMOTED, RETRAIN_*, MODEL_STARTED/STOPPED).
   */
  fromStatus?: string | null;
  toStatus?: string | null;
  /** The RAW HealthReason code (e.g. SOURCE_UNREACHABLE) — the client labels
   *  it, this table never stores a display string (D02). */
  reason?: string | null;
  /**
   * Whatever makes THIS occurrence of the event unique for this model —
   * mixed with modelId/axis to build `NotificationDelivery.eventKey`
   * (unique per channel) AND `NotificationEvent.dedupeKey` (unique per
   * occurrence). For a sweep-driven transition this is
   * `${status}:${reason}:${at.getTime()}`; for a discrete event tied to a
   * real row (a promote, a retrain job) it should be that row's own id, so
   * a genuinely repeated real-world event never collides with an earlier
   * one under the unique constraint.
   */
  eventKeySeed: string;
  /**
   * MODEL-SERVE-031. False writes the `NotificationEvent` (the navbar bell
   * still reads it) but NO per-model `NotificationDelivery` — the evaluator
   * sends one workspace digest per channel instead (`enqueueDigest`).
   * Defaults to true, so every discrete write site is unchanged.
   */
  deliver?: boolean;
}

export interface EnqueueDigestParams {
  channelId: string;
  workspaceId: string;
  digest: DigestData;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  at: Date;
  /** Unique per channel per sweep — `NotificationDelivery`'s
   *  `(channelId, eventKey)` unique index makes a replay harmless. */
  eventKeySeed: string;
}

export const MONITORING_DIGEST_EVENT = 'MONITORING_DIGEST';

/**
 * MODEL-SERVE-022-D04/D10/T03/T07. THE OUTBOX WRITER — never sends anything
 * itself (`NotificationDeliveryService` does that, on its own sweep).
 *
 * Writes the SINGLE `NotificationEvent` row every surface (Teams, e-mail,
 * the navbar bell) reads from — UNCONDITIONALLY, before any channel is
 * looked up, since the in-app feed exists even in a workspace with zero
 * configured channels (T07 audit_findings). Only then does it filter the
 * workspace's channels against the event/severity/mute rules and write one
 * `NotificationDelivery` row per matching channel, each pointing back at
 * that event via `eventId`.
 *
 * `enqueueInTx` takes the CALLER'S transaction client so the evaluator can
 * write `ModelAlertState` and enqueue the event+deliveries atomically
 * (V04) — this class holds no transaction of its own for that path.
 * `enqueueDiscrete` is the OTHER shape: a write site (promote, retrain,
 * preflight) that already committed its own durable write and now wants to
 * notify BEST-EFFORT, never risking the caller's own success on a
 * notification failure.
 */
@Injectable()
export class NotificationOutboxService {
  private readonly log = new Logger(NotificationOutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueueInTx(
    tx: PrismaTypes.TransactionClient,
    params: EnqueueParams,
  ): Promise<void> {
    const msg = buildNotificationMessage({
      modelId: params.modelId,
      modelName: params.modelName,
      workspaceName: params.workspaceName,
      axis: params.axis,
      title: params.title,
      detail: params.detail,
      rawDetailSuffix: params.rawDetailSuffix,
      frozenColumns: params.frozenColumns,
      severity: params.severity,
      at: params.at,
    });
    // V02: payload is built from an ALREADY-REDACTED message (the builder
    // redacts `rawDetailSuffix` before returning) — every row below is a
    // sink for whatever failureReason/preflightReason text it carries, so
    // redaction cannot happen only at send time.
    const payload = {
      title: msg.title,
      bodyText: msg.bodyText,
      modelUrl: msg.modelUrl,
    } as PrismaTypes.InputJsonValue;

    // dedupeKey/eventKey share one value: it is already unique per REAL
    // occurrence (model + axis + transition/seed), never per channel, so
    // the exact string that guarantees "one NotificationDelivery row per
    // channel per occurrence" also guarantees "one NotificationEvent row
    // per occurrence" — one string, two uniqueness guarantees, not two.
    const dedupeKey = `${params.modelId}:${params.axis ?? 'NONE'}:${params.eventKeySeed}`;

    // MODEL-SERVE-022-D10/T07. `update: {}` on replay: the FIRST write is
    // authoritative — a retried evaluator pass or write-site call must
    // never overwrite an already-recorded event.
    const event = await tx.notificationEvent.upsert({
      where: { dedupeKey },
      create: {
        workspaceId: params.workspaceId,
        modelId: params.modelId,
        axis: params.axis,
        kind: params.event,
        severity: params.severity,
        fromStatus: params.fromStatus ?? null,
        toStatus: params.toStatus ?? null,
        reason: params.reason ?? null,
        payload,
        dedupeKey,
      },
      update: {},
    });

    const channels = await tx.notificationChannel.findMany({
      where: {
        workspaceId: params.workspaceId,
        enabled: true,
        events: { has: params.event },
        // Explicit allow-list (MODEL-SERVE-022-D-FOCUS): only channels that
        // selected this model.
        focusModelIds: { has: params.modelId },
      },
    });
    const eligible = channels.filter(
      (c) => SEVERITY_RANK[params.severity] >= SEVERITY_RANK[c.minSeverity],
    );
    if (eligible.length === 0 || params.deliver === false) return;

    const rows = eligible.map((c) => ({
      channelId: c.id,
      eventId: event.id,
      modelId: params.modelId,
      axis: params.axis,
      event: params.event,
      severity: params.severity,
      eventKey: dedupeKey,
      payload,
    }));

    // `skipDuplicates`: a retried evaluator pass (before its own
    // transaction committed) could reach here again with the SAME
    // eventKey — the unique index is the real backstop, this just avoids
    // a thrown P2002 turning a harmless replay into a sweep-ending error.
    await tx.notificationDelivery.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }

  /** Best-effort: NEVER throws. A write site (promote, retrain, preflight,
   *  start/stop) has already committed its own durable write before
   *  calling this — a notification failure must never surface there. */
  async enqueueDiscrete(params: EnqueueParams): Promise<void> {
    try {
      await this.prisma.$transaction((tx) => this.enqueueInTx(tx, params));
    } catch (err) {
      this.log.warn(
        `notification enqueue failed for model ${params.modelId} event ${params.event}: ${(err as Error).message}`,
      );
    }
  }

  /** MODEL-SERVE-031. One workspace-digest delivery for ONE channel. No
   *  `NotificationEvent` and no model: the per-model events already exist
   *  (the bell reads those), this row only carries the table. Best-effort
   *  like `enqueueDiscrete` — a failure must never fail the sweep. */
  async enqueueDigest(params: EnqueueDigestParams): Promise<void> {
    try {
      const msg = buildDigestMessage({
        digest: params.digest,
        workspaceId: params.workspaceId,
        at: params.at,
      });
      await this.prisma.notificationDelivery.createMany({
        data: [
          {
            channelId: params.channelId,
            modelId: null,
            axis: 'MONITORING',
            event: MONITORING_DIGEST_EVENT,
            severity: params.severity,
            eventKey: `digest:${params.workspaceId}:${params.eventKeySeed}`,
            payload: {
              title: msg.title,
              bodyText: msg.bodyText,
              modelUrl: msg.modelUrl,
              digest: msg.digest,
            } as unknown as PrismaTypes.InputJsonValue,
          },
        ],
        skipDuplicates: true,
      });
    } catch (err) {
      this.log.warn(
        `digest enqueue failed for channel ${params.channelId}: ${(err as Error).message}`,
      );
    }
  }
}
