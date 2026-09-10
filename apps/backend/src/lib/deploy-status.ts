import { PrismaService } from '@softsensor/prisma';
import { env } from '@/config/env.config';

/**
 * MODEL-SERVE-006-T12. Per decisions.deploy_status_currently_asserts_
 * something_untrue: `Model.data.deployStatus` used to be whatever the last
 * caller wrote (`updateModel(modelId, { deployStatus: 'running' })`,
 * phase-6-deploy.tsx's old behaviour) — a claim nothing backed. Once
 * InferenceWindow rows exist, "is this deployed" has a real referent, and
 * this module is the ONE place that reads it — no caller sets it directly
 * anymore (`UpdateModelSchema` no longer accepts the field).
 *
 * `classifyDeployStatus` is the pure state machine, shared by the batched
 * list-derivation below AND `InferenceWindowAuthorizedService.
 * getStatusService`'s own single-model read — one implementation of what
 * the four statuses MEAN, not two that could drift apart.
 */
export type DeployStatus = 'stopped' | 'running' | 'error' | 'initializing';

export function classifyDeployStatus(input: {
  enabled: boolean;
  hasEverSucceeded: boolean;
  staleness: 'OK' | 'STALE';
  failing: boolean;
}): DeployStatus {
  if (!input.enabled) return 'stopped';
  if (input.failing) return 'error';
  if (input.staleness === 'STALE') {
    // Never produced a single window yet — the schedule was just turned
    // on, not broken. Distinct from the case below: a schedule that WAS
    // producing and has since gone quiet is a real problem, not a warm-up.
    return input.hasEverSucceeded ? 'error' : 'initializing';
  }
  return 'running';
}

/**
 * Batched derivation for a LIST of models (`getModelsService`/
 * `getWorkspaceModels`) — avoids N+1 queries. Two non-N+1 reads
 * (schedules, and a `groupBy` for each model's last SUCCEEDED/SKIPPED
 * window) plus one bounded `findMany` per ENABLED schedule for the
 * "failing" check (last 3 terminal windows all FAILED) — proportional to
 * how many schedules are actually enabled in the list, not to every model
 * in the system.
 *
 * Returns a status for every id in `modelIds`, defaulting absent entries
 * (no schedule at all) to 'stopped'.
 */
export async function deriveDeployStatuses(
  prisma: PrismaService,
  modelIds: string[],
): Promise<Record<string, DeployStatus>> {
  const result: Record<string, DeployStatus> = {};
  for (const id of modelIds) result[id] = 'stopped';
  if (modelIds.length === 0) return result;

  const schedules = await prisma.inferenceSchedule.findMany({
    where: { modelId: { in: modelIds } },
    select: { modelId: true, enabled: true, cadenceMinutes: true },
  });
  if (schedules.length === 0) return result;

  const enabledIds = schedules.filter((s) => s.enabled).map((s) => s.modelId);

  const lastSucceededGroups = enabledIds.length
    ? await prisma.inferenceWindow.groupBy({
        by: ['modelId'],
        where: {
          modelId: { in: enabledIds },
          status: { in: ['SUCCEEDED', 'SKIPPED'] },
        },
        _max: { windowStart: true },
      })
    : [];
  const lastSucceededByModel = new Map(
    lastSucceededGroups.map((g) => [g.modelId, g._max.windowStart]),
  );

  const failingByModel = new Map<string, boolean>();
  await Promise.all(
    enabledIds.map(async (modelId) => {
      const recentTerminal = await prisma.inferenceWindow.findMany({
        where: { modelId, status: { in: ['SUCCEEDED', 'SKIPPED', 'FAILED'] } },
        orderBy: { windowStart: 'desc' },
        take: 3,
        select: { status: true },
      });
      failingByModel.set(
        modelId,
        recentTerminal.length >= 3 &&
          recentTerminal.every((w) => w.status === 'FAILED'),
      );
    }),
  );

  for (const schedule of schedules) {
    const lastSucceededAt = lastSucceededByModel.get(schedule.modelId) ?? null;
    const staleAfterMs =
      env.INFERENCE_STALE_AFTER_CADENCES * schedule.cadenceMinutes * 60_000;
    const staleness: 'OK' | 'STALE' =
      !lastSucceededAt || Date.now() - lastSucceededAt.getTime() > staleAfterMs
        ? 'STALE'
        : 'OK';
    result[schedule.modelId] = classifyDeployStatus({
      enabled: schedule.enabled,
      hasEverSucceeded: lastSucceededAt !== null,
      staleness,
      failing: failingByModel.get(schedule.modelId) ?? false,
    });
  }

  return result;
}

/**
 * Overlays a derived `deployStatus` onto one model row's `data` blob for a
 * response — the ONE merge shape every read site (`getModelsService`,
 * `updateModelService`, `appendLogService`, `getWorkspaceModels`) now uses,
 * so "derive at read time" means the same thing everywhere it happens.
 * Never mutates the input; returns a new object.
 */
export function overlayDeployStatus<T extends { id: string; data: unknown }>(
  model: T,
  status: DeployStatus,
): T {
  const current =
    model.data && typeof model.data === 'object' && !Array.isArray(model.data)
      ? (model.data as Record<string, unknown>)
      : {};
  return { ...model, data: { ...current, deployStatus: status } };
}
