import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { env } from '@/config/env.config';
import { deriveDeployStatuses } from '@/lib/deploy-status';
import {
  evaluateMonitoringTransition,
  type MonitoringSnapshot,
} from '@/lib/notification-transition';
import { monitoringTransitionDetail } from '@/lib/notification-message';
import { monitoringStatusFromHealth } from '@/lib/notification-monitoring-status';
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

      for (const modelId of candidates) {
        try {
          await this.evaluateOne(modelId, deployStates[modelId]?.status);
        } catch (err) {
          this.log.warn(
            `evaluation failed for model ${modelId}: ${(err as Error).message}`,
          );
        }
      }
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
  ): Promise<void> {
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
    if (!model) return; // deleted mid-sweep — defensive only.

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
    if (!result.changed) return;

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.modelAlertState.upsert({
        where: { modelId_axis: { modelId, axis: 'MONITORING' } },
        create: {
          modelId,
          axis: 'MONITORING',
          status: next.status,
          reason: next.reason,
          frozenColumns: next.frozenColumns,
        },
        update: {
          status: next.status,
          reason: next.reason,
          frozenColumns: next.frozenColumns,
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
      });
    });
  }
}
