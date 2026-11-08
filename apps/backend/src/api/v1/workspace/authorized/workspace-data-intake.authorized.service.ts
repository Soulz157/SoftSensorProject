import { Injectable } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import {
  addTagCounts,
  emptyTagCounts,
  fillBuckets,
  overallBadPct,
  rangeWindow,
  rollupStorage,
  rollupTags,
  rowsByWorkspace,
  type ArtifactInput,
  type IngestionPoint,
  type IntakeRange,
  type IntakeWindow,
  type PredictBucketRow,
  type ScheduledBucketRow,
  type TagCounts,
  type TagObservationInput,
  type TagRow,
} from '@/lib/data-intake';
import { WorkspaceAuthorizedService } from './workspace.authorized.service';

export interface IntakeStorage {
  savedBytes: number;
  activeDraftBytes: number;
  cleanupBytes: number;
  totalBytes: number;
}

export interface IntakeTotals {
  liveModels: number;
  tags: TagCounts;
  rowsIngested: number;
  /** Share of scheduled input cells that were not Good, 0–100; null = none. */
  badCellPct: number | null;
  storage: IntakeStorage;
  datasetCount: number;
}

interface IntakeBase {
  range: IntakeRange;
  from: string;
  to: string;
  totals: IntakeTotals;
  ingestion: IngestionPoint[];
}

export interface WorkspaceIntakeDataset {
  id: string;
  name: string;
  tagCount: number;
  rowCount: number;
  missingPct: number;
  sizeBytes: number;
  updatedAt: string;
}

export interface WorkspaceIntake extends IntakeBase {
  scope: 'workspace';
  workspaceId: string;
  tags: TagRow[];
  datasets: WorkspaceIntakeDataset[];
}

export interface WorkspaceIntakeRow {
  id: string;
  name: string;
  liveModels: number;
  tags: TagCounts;
  rowsIngested: number;
  storageBytes: number;
  datasetCount: number;
}

export interface AllWorkspacesIntake extends IntakeBase {
  scope: 'all';
  workspaces: WorkspaceIntakeRow[];
}

/**
 * Data Intake analytics: what arrives (scheduled windows + live predict),
 * the live tags' arrival quality, and the bytes datasets hold.
 *
 * Volume is bucketed IN SQL — a 1y × all-workspaces range can hold tens of
 * thousands of windows per model, which must not be pulled into Node.
 */
@Injectable()
export class WorkspaceDataIntakeAuthorizedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAuthorizedService,
  ) {}

  async getWorkspaceIntake(
    workspaceId: string,
    user: Auth.UserPayload,
    range: IntakeRange,
    now: Date = new Date(),
  ) {
    return {
      statusCode: 200,
      message: 'Data intake fetched successfully',
      type: 'SUCCESS' as const,
      data: await this.buildWorkspaceIntake(workspaceId, user, range, now),
    };
  }

  /** Admin only — the controller enforces `@Roles('ADMIN')`. */
  async getAllIntake(range: IntakeRange, now: Date = new Date()) {
    return {
      statusCode: 200,
      message: 'Data intake fetched successfully',
      type: 'SUCCESS' as const,
      data: await this.buildAllIntake(range, now),
    };
  }

  private async buildWorkspaceIntake(
    workspaceId: string,
    user: Auth.UserPayload,
    range: IntakeRange,
    now: Date,
  ): Promise<WorkspaceIntake> {
    await this.access.assertHasAccess(workspaceId, user.id, user.role);
    const exists = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }

    const window = rangeWindow(range, now);
    const [scheduled, predict, observations, liveModels, artifacts, datasets] =
      await Promise.all([
        this.scheduledRows(window, workspaceId),
        this.predictRows(window, workspaceId),
        this.observations(workspaceId),
        this.liveModelRows(workspaceId),
        this.artifacts(workspaceId),
        this.prisma.dataset.findMany({
          where: { workspaceId },
          select: {
            id: true,
            name: true,
            tags: true,
            rowCount: true,
            missingPct: true,
            updatedAt: true,
          },
        }),
      ]);

    const { rows: tagRows, counts } = rollupTags(observations, now);
    const storage = rollupStorage(artifacts.map((a) => a.input));

    return {
      scope: 'workspace',
      workspaceId,
      range,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      totals: {
        liveModels: liveModels.length,
        tags: counts,
        rowsIngested: sumRows(scheduled) + sumRows(predict),
        badCellPct: overallBadPct(scheduled),
        storage: storageTotals(storage),
        datasetCount: datasets.length,
      },
      ingestion: fillBuckets(scheduled, predict, window),
      tags: tagRows,
      datasets: datasets
        .map((d) => ({
          id: d.id,
          name: d.name,
          tagCount: d.tags.length,
          rowCount: d.rowCount,
          missingPct: d.missingPct,
          sizeBytes: storage.byDataset.get(d.id) ?? 0,
          updatedAt: d.updatedAt.toISOString(),
        }))
        .sort((a, b) => b.sizeBytes - a.sizeBytes),
    };
  }

  private async buildAllIntake(
    range: IntakeRange,
    now: Date,
  ): Promise<AllWorkspacesIntake> {
    const window = rangeWindow(range, now);
    const [
      workspaces,
      scheduled,
      predict,
      observations,
      liveModels,
      artifacts,
      datasetCounts,
    ] = await Promise.all([
      this.prisma.workspace.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.scheduledRows(window),
      this.predictRows(window),
      this.observations(),
      this.liveModelRows(),
      this.artifacts(),
      this.prisma.dataset.groupBy({
        by: ['workspaceId'],
        _count: { _all: true },
      }),
    ]);

    const rowsPerWs = rowsByWorkspace(scheduled, predict);
    const obsPerWs = groupBy(observations, (o) => o.workspaceId);
    const artifactsPerWs = groupBy(artifacts, (a) => a.workspaceId);
    const liveModelsPerWs = new Map<string, number>();
    for (const m of liveModels) {
      liveModelsPerWs.set(
        m.workspaceId,
        (liveModelsPerWs.get(m.workspaceId) ?? 0) + 1,
      );
    }
    const datasetsPerWs = new Map(
      datasetCounts.map((c) => [c.workspaceId, c._count._all]),
    );

    let tags = emptyTagCounts();
    const storage: IntakeStorage = {
      savedBytes: 0,
      activeDraftBytes: 0,
      cleanupBytes: 0,
      totalBytes: 0,
    };
    let datasetCount = 0;
    const rows: WorkspaceIntakeRow[] = workspaces.map((ws) => {
      const { counts } = rollupTags(obsPerWs.get(ws.id) ?? [], now);
      const wsStorage = storageTotals(
        rollupStorage((artifactsPerWs.get(ws.id) ?? []).map((a) => a.input)),
      );
      const wsDatasets = datasetsPerWs.get(ws.id) ?? 0;
      tags = addTagCounts(tags, counts);
      storage.savedBytes += wsStorage.savedBytes;
      storage.activeDraftBytes += wsStorage.activeDraftBytes;
      storage.cleanupBytes += wsStorage.cleanupBytes;
      storage.totalBytes += wsStorage.totalBytes;
      datasetCount += wsDatasets;
      return {
        id: ws.id,
        name: ws.name,
        liveModels: liveModelsPerWs.get(ws.id) ?? 0,
        tags: counts,
        rowsIngested: rowsPerWs.get(ws.id) ?? 0,
        storageBytes: wsStorage.totalBytes,
        datasetCount: wsDatasets,
      };
    });

    return {
      scope: 'all',
      range,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      totals: {
        liveModels: liveModels.length,
        tags,
        rowsIngested: sumRows(scheduled) + sumRows(predict),
        badCellPct: overallBadPct(scheduled),
        storage,
        datasetCount,
      },
      ingestion: fillBuckets(scheduled, predict, window),
      workspaces: rows,
    };
  }

  // -- queries ---------------------------------------------------------------

  /** SUCCEEDED windows always write both `inputRows` and `missingPct`. */
  private scheduledRows(
    window: IntakeWindow,
    workspaceId?: string,
  ): Promise<ScheduledBucketRow[]> {
    const stride = window.bucketMs / 1000;
    const scope = workspaceId
      ? PrismaTypes.sql`AND m."workspaceId" = ${workspaceId}`
      : PrismaTypes.empty;
    return this.prisma.$queryRaw<ScheduledBucketRow[]>(PrismaTypes.sql`
      SELECT
        (floor(extract(epoch FROM w."windowEnd") / ${stride}::float8) * ${stride}::float8)::float8 AS bucket,
        m."workspaceId" AS "workspaceId",
        SUM(w."inputRows")::float8 AS rows,
        SUM(w."missingPct" * w."inputRows")::float8 AS "badWeighted"
      FROM "InferenceWindow" w
      JOIN "Model" m ON m."id" = w."modelId"
      WHERE w."status" = 'SUCCEEDED'
        AND w."inputRows" IS NOT NULL
        AND w."missingPct" IS NOT NULL
        AND w."windowEnd" >= ${window.from}
        AND w."windowEnd" <= ${window.to}
        ${scope}
      GROUP BY 1, 2
    `);
  }

  private predictRows(
    window: IntakeWindow,
    workspaceId?: string,
  ): Promise<PredictBucketRow[]> {
    const stride = window.bucketMs / 1000;
    const scope = workspaceId
      ? PrismaTypes.sql`AND m."workspaceId" = ${workspaceId}`
      : PrismaTypes.empty;
    return this.prisma.$queryRaw<PredictBucketRow[]>(PrismaTypes.sql`
      SELECT
        (floor(extract(epoch FROM p."requestedAt") / ${stride}::float8) * ${stride}::float8)::float8 AS bucket,
        m."workspaceId" AS "workspaceId",
        SUM(p."rowCount")::float8 AS rows
      FROM "PredictionLog" p
      JOIN "Model" m ON m."id" = p."modelId"
      WHERE p."requestedAt" >= ${window.from}
        AND p."requestedAt" <= ${window.to}
        ${scope}
      GROUP BY 1, 2
    `);
  }

  private async observations(
    workspaceId?: string,
  ): Promise<(TagObservationInput & { workspaceId: string })[]> {
    const rows = await this.prisma.tagObservation.findMany({
      where: workspaceId ? { model: { workspaceId } } : undefined,
      select: {
        tag: true,
        lastValue: true,
        lastStatus: true,
        lastSeenAt: true,
        lastChangedAt: true,
        model: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            inferenceSchedule: {
              select: {
                enabled: true,
                livePredictEnabled: true,
                cadenceMinutes: true,
              },
            },
          },
        },
      },
    });
    return rows.map((r) => {
      const schedule = r.model.inferenceSchedule;
      return {
        workspaceId: r.model.workspaceId,
        modelId: r.model.id,
        modelName: r.model.name,
        tag: r.tag,
        lastValue: r.lastValue,
        lastStatus: r.lastStatus,
        lastSeenAt: r.lastSeenAt,
        lastChangedAt: r.lastChangedAt,
        scheduleLive:
          !!schedule && (schedule.enabled || schedule.livePredictEnabled),
        cadenceMinutes: schedule?.cadenceMinutes ?? 60,
      };
    });
  }

  private liveModelRows(workspaceId?: string) {
    return this.prisma.model.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        inferenceSchedule: {
          OR: [{ enabled: true }, { livePredictEnabled: true }],
        },
      },
      select: { workspaceId: true },
    });
  }

  /** Every artifact whose object still exists (`objectReclaimedAt` null). */
  private async artifacts(
    workspaceId?: string,
  ): Promise<{ workspaceId: string; input: ArtifactInput }[]> {
    const rows = await this.prisma.datasetArtifact.findMany({
      where: {
        objectReclaimedAt: null,
        ...(workspaceId
          ? {
              OR: [{ dataset: { workspaceId } }, { draft: { workspaceId } }],
            }
          : {}),
      },
      select: {
        objectKey: true,
        sizeBytes: true,
        datasetId: true,
        draftId: true,
        dataset: { select: { workspaceId: true } },
        draft: { select: { workspaceId: true, status: true } },
      },
    });
    const out: { workspaceId: string; input: ArtifactInput }[] = [];
    for (const r of rows) {
      const owner = r.dataset?.workspaceId ?? r.draft?.workspaceId;
      if (!owner) continue;
      out.push({
        workspaceId: owner,
        input: {
          objectKey: r.objectKey,
          sizeBytes: r.sizeBytes,
          datasetId: r.datasetId,
          draftId: r.draftId,
          draftStatus: r.draft?.status ?? null,
        },
      });
    }
    return out;
  }
}

function sumRows(rows: { rows: number }[]): number {
  return rows.reduce((sum, r) => sum + r.rows, 0);
}

function storageTotals(s: IntakeStorage): IntakeStorage {
  return {
    savedBytes: s.savedBytes,
    activeDraftBytes: s.activeDraftBytes,
    cleanupBytes: s.cleanupBytes,
    totalBytes: s.totalBytes,
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}
