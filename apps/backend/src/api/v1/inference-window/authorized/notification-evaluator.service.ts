import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { env } from '@/config/env.config';
import { deriveDeployStatuses } from '@/lib/deploy-status';
import {
  evaluateMonitoringTransition,
  type MonitoringSnapshot,
} from '@/lib/notification-transition';
import { monitoringTransitionDetail } from '@/lib/notification-message';
import { monitoringStatusFromHealth } from '@/lib/notification-monitoring-status';
import {
  buildDigestData,
  buildMetrics,
  parseMetrics,
  resolveStatusSince,
} from '@/lib/notification-digest';
import type { DigestChange } from '@/lib/notification-digest';
import { NotificationOutboxService } from '@/api/v1/notification/core/notification-outbox.service';
import { InferenceWindowMonitoringService } from './inference-window-monitoring.authorized.service';

/**
 * MODEL-SERVE-022-T03/D08. Watches the MONITORING axis only — see D08 for
 * why the DEPLOY axis is covered entirely by write-site hooks instead.
 * Reuses `InferenceWindowMonitoringService.getHealthStatus` (the SAME call
 * the Model Detail badge makes) and `deriveDeployStatuses` (for the
 * DeployStatus argument the five-word vocabulary needs) — computes no
 * status of its own, per D02.
 *
 * Own sweep, same `.unref()` shape as `InferenceTruthSweeperService`.
 * Bounded per sweep by NOTIFY_EVAL_MAX_PER_SWEEP, oldest-evaluated-first (a
 * model with no `ModelAlertState` row yet is treated as oldest of all, so a
 * freshly enabled schedule is never starved behind a fleet of already-
 * tracked ones).
 */
const SEVERITY_RANK: Record<NotifiedTransition['severity'], number> = {
  INFO: 0,
  WARNING: 1,
  CRITICAL: 2,
};

/** One notified status change in this sweep — the trigger for a digest, and
 *  one line of its "Changed this check" footer. */
interface NotifiedTransition {
  workspaceId: string;
  workspaceName: string;
  modelId: string;
  modelName: string;
  event: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  fromStatus: string | null;
  toStatus: string;
}

@Injectable()
export class NotificationEvaluatorService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly log = new Logger(NotificationEvaluatorService.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly monitoring: InferenceWindowMonitoringService,
    private readonly outbox: NotificationOutboxService,
  ) {}

  onModuleInit() {
    if (env.NOTIFY_EVAL_INTERVAL_MS <= 0) {
      this.log.log('notification evaluator disabled (interval <= 0)');
      return;
    }
    this.timer = setInterval(
      () => void this.sweep(),
      env.NOTIFY_EVAL_INTERVAL_MS,
    ).unref();
    this.log.log(
      `notification evaluator scheduled every ${env.NOTIFY_EVAL_INTERVAL_MS}ms`,
    );
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const candidates = await this.selectCandidates();
      if (candidates.length === 0) return;

      const deployStates = await deriveDeployStatuses(this.prisma, candidates);

      const transitions: NotifiedTransition[] = [];
      for (const modelId of candidates) {
        try {
          const t = await this.evaluateOne(
            modelId,
            deployStates[modelId]?.status,
          );
          if (t) transitions.push(t);
        } catch (err) {
          this.log.warn(
            `evaluation failed for model ${modelId}: ${(err as Error).message}`,
          );
        }
      }
      await this.sendDigests(transitions);
    } catch (err) {
      this.log.warn(`notification sweep failed: ${(err as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }

  /** Enabled schedules' model ids, oldest-`ModelAlertState`-first — a model
   *  with no row yet sorts first (never evaluated is older than any real
   *  timestamp). */
  private async selectCandidates(): Promise<string[]> {
    const schedules = await this.prisma.inferenceSchedule.findMany({
      where: { enabled: true },
      select: { modelId: true },
    });
    if (schedules.length === 0) return [];
    const modelIds = schedules.map((s) => s.modelId);

    const states = await this.prisma.modelAlertState.findMany({
      where: { modelId: { in: modelIds }, axis: 'MONITORING' },
      select: { modelId: true, updatedAt: true },
    });
    const updatedAtByModel = new Map(
      states.map((s) => [s.modelId, s.updatedAt.getTime()]),
    );

    return [...modelIds]
      .sort(
        (a, b) =>
          (updatedAtByModel.get(a) ?? 0) - (updatedAtByModel.get(b) ?? 0),
      )
      .slice(0, env.NOTIFY_EVAL_MAX_PER_SWEEP);
  }

  private async evaluateOne(
    modelId: string,
    deployStatus: string | undefined,
  ): Promise<NotifiedTransition | null> {
    const [health, model, prevRow] = await Promise.all([
      this.monitoring.getHealthStatus(modelId),
      this.prisma.model.findUnique({
        where: { id: modelId },
        select: { name: true, workspace: { select: { id: true, name: true } } },
      }),
      this.prisma.modelAlertState.findUnique({
        where: { modelId_axis: { modelId, axis: 'MONITORING' } },
      }),
    ]);
    if (!model) return null; // deleted mid-sweep — defensive only.

    const prev: MonitoringSnapshot | null = prevRow
      ? {
          status: prevRow.status as MonitoringSnapshot['status'],
          reason: prevRow.reason as MonitoringSnapshot['reason'],
          frozenColumns: prevRow.frozenColumns,
        }
      : null;
    const next: MonitoringSnapshot = {
      status: health.status,
      reason: health.reason,
      frozenColumns: health.frozenColumns,
    };

    const result = evaluateMonitoringTransition(prev, next);

    // MODEL-SERVE-031. Written on EVERY pass, not only on a change: the
    // digest reads these numbers back from `ModelAlertState`, so they must
    // not go stale while the status stays put. Side effect: `updatedAt` now
    // moves each evaluation, which makes `selectCandidates` true round-robin.
    const statusWord = monitoringStatusFromHealth(
      health.status,
      deployStatus as Parameters<typeof monitoringTransitionDetail>[3],
    );
    const metrics = buildMetrics({
      psiSummary: health.psiSummary,
      sdRatio: health.residualSd.ratio,
      thresholds: health.thresholds,
      statusWord,
      statusSince: resolveStatusSince({
        prevMetrics: prevRow ? parseMetrics(prevRow.metrics) : null,
        prevStatus: prevRow?.status ?? null,
        prevUpdatedAt: prevRow?.updatedAt ?? null,
        nextStatus: health.status,
        nextWord: statusWord,
        now: new Date(),
      }),
    }) as unknown as PrismaTypes.InputJsonValue;

    if (!result.changed) {
      await this.prisma.modelAlertState.upsert({
        where: { modelId_axis: { modelId, axis: 'MONITORING' } },
        create: {
          modelId,
          axis: 'MONITORING',
          status: next.status,
          reason: next.reason,
          frozenColumns: next.frozenColumns,
          metrics,
        },
        update: { metrics },
      });
      return null;
    }

    const now = new Date();
    let transition: NotifiedTransition | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.modelAlertState.upsert({
        where: { modelId_axis: { modelId, axis: 'MONITORING' } },
        create: {
          modelId,
          axis: 'MONITORING',
          status: next.status,
          reason: next.reason,
          frozenColumns: next.frozenColumns,
          metrics,
        },
        update: {
          status: next.status,
          reason: next.reason,
          frozenColumns: next.frozenColumns,
          metrics,
        },
      });

      if (!result.notify) return;

      const deployArg = deployStatus as Parameters<
        typeof monitoringTransitionDetail
      >[3];
      const detail = monitoringTransitionDetail(
        prev?.status ?? null,
        next.status,
        next.reason,
        deployArg,
      );
      // MODEL-SERVE-022-T07/D09. The SAME five-word vocabulary `detail`
      // renders — stored raw on NotificationEvent for the navbar bell,
      // rather than re-parsed out of the formatted `detail` string later.
      const toStatus = monitoringStatusFromHealth(next.status, deployArg);
      const fromStatus = prev
        ? monitoringStatusFromHealth(prev.status, deployArg)
        : null;

      await this.outbox.enqueueInTx(tx, {
        workspaceId: model.workspace.id,
        modelId,
        modelName: model.name,
        workspaceName: model.workspace.name,
        axis: 'MONITORING',
        event: result.notify.event,
        severity: result.notify.severity,
        title: `${model.name}: ${result.notify.event.replace(/_/g, ' ').toLowerCase()}`,
        detail,
        fromStatus,
        toStatus,
        reason: next.reason,
        frozenColumns:
          next.status === 'FROZEN'
            ? health.frozenSince.map((f) => ({
                column: f.column,
                flatMinutes: f.flatMinutes,
              }))
            : undefined,
        at: now,
        eventKeySeed: `${next.status}:${next.reason ?? 'none'}:${now.getTime()}`,
        // The bell keeps its per-model event; the Teams/e-mail message is
        // the workspace digest `sendDigests` writes after the loop.
        deliver: false,
      });
      transition = {
        workspaceId: model.workspace.id,
        workspaceName: model.workspace.name,
        modelId,
        modelName: model.name,
        event: result.notify.event,
        severity: result.notify.severity,
        fromStatus,
        toStatus,
      };
    });
    return transition;
  }

  /**
   * MODEL-SERVE-031. One digest per ENABLED CHANNEL (not per workspace):
   * `focusModelIds` is a per-channel allow-list, so "N of M" and the rows
   * differ between channels. A channel gets a digest only if at least one
   * transition THIS sweep passes its own event / minSeverity / focus filters
   * — the same three the per-model outbox applied. The rows themselves come
   * from persisted `ModelAlertState`, never from this sweep's subset.
   */
  private async sendDigests(transitions: NotifiedTransition[]): Promise<void> {
    if (transitions.length === 0) return;
    const sweepTs = Date.now();
    const at = new Date(sweepTs);
    const byWorkspace = new Map<string, NotifiedTransition[]>();
    for (const t of transitions) {
      byWorkspace.set(t.workspaceId, [
        ...(byWorkspace.get(t.workspaceId) ?? []),
        t,
      ]);
    }
    const legend = {
      warn: env.PSI_WARN,
      critical: env.PSI_CRITICAL,
      outOfRangeWarnPct: env.PSI_OUT_OF_RANGE_WARN_PCT,
      outOfRangeCriticalPct: env.PSI_OUT_OF_RANGE_CRITICAL_PCT,
    };

    for (const [workspaceId, wsTransitions] of byWorkspace) {
      try {
        const channels = await this.prisma.notificationChannel.findMany({
          where: { workspaceId, enabled: true },
        });
        for (const channel of channels) {
          const relevant = wsTransitions.filter(
            (t) =>
              channel.events.includes(t.event) &&
              channel.focusModelIds.includes(t.modelId) &&
              SEVERITY_RANK[t.severity] >= SEVERITY_RANK[channel.minSeverity],
          );
          if (relevant.length === 0) continue;

          const schedules = await this.prisma.inferenceSchedule.findMany({
            where: { enabled: true, modelId: { in: channel.focusModelIds } },
            select: { modelId: true },
          });
          const watched = schedules.map((s) => s.modelId);
          const states = await this.prisma.modelAlertState.findMany({
            where: { modelId: { in: watched }, axis: 'MONITORING' },
            select: {
              modelId: true,
              status: true,
              reason: true,
              frozenColumns: true,
              metrics: true,
              model: { select: { name: true } },
            },
          });
          const changes: DigestChange[] = relevant.map((t) => ({
            model: t.modelName,
            from: t.fromStatus,
            to: t.toStatus,
          }));
          const digest = buildDigestData({
            workspaceName: relevant[0].workspaceName,
            total: watched.length,
            states: states.map((st) => ({
              modelId: st.modelId,
              modelName: st.model.name,
              status: st.status,
              reason: st.reason,
              frozenColumns: st.frozenColumns,
              metrics: st.metrics,
            })),
            legend,
            changes,
            at,
          });
          const severity = relevant.reduce<NotifiedTransition['severity']>(
            (max, t) =>
              SEVERITY_RANK[t.severity] > SEVERITY_RANK[max] ? t.severity : max,
            'INFO',
          );
          await this.outbox.enqueueDigest({
            channelId: channel.id,
            workspaceId,
            digest,
            severity,
            at,
            eventKeySeed: String(sweepTs),
          });
        }
      } catch (err) {
        this.log.warn(
          `digest failed for workspace ${workspaceId}: ${(err as Error).message}`,
        );
      }
    }
  }
}
