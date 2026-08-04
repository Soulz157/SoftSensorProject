import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { decryptSecret } from '@/lib/crypto';
import { postToPython, PYTHON_TIMEOUT } from '@/lib/python-client';
import { PreprocessingJobService } from './preprocessing-job.service';
import {
  ArtifactStatsSchema,
  PythonPreviewSchema,
  PythonRowsSchema,
  type CreateRawVersionDto,
  type ListRowsDto,
  type PreviewVersionDto,
  type StartCleanJobDto,
} from './dto/dataset-version.authorized.dto';

/**
 * Dataset versions and preprocessing jobs.
 *
 * Access control differs DELIBERATELY from the Dataset CRUD routes next door.
 * Those filter on `createdById === userId` (`dataset.authorized.service.ts:82`,
 * :128, :161); this service uses owner-or-member workspace access. Versions are
 * workspace artifacts — scoping them to their creator would make a teammate's
 * cleaned data invisible inside a workspace they belong to. The asymmetry on
 * the CRUD routes is a separate pre-existing issue and is not propagated here.
 *
 * The ADMIN bypass IS shared with the CRUD routes, though — see
 * assertDatasetAccess. That one has to match, or an admin can create a dataset
 * somewhere they cannot then read it.
 *
 * Rows never pass through this service. It sends keys and parameters to the
 * connector and stores what comes back; frames go straight from the source into
 * object storage without a detour through the API server.
 */
@Injectable()
export class DatasetVersionAuthorizedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: PreprocessingJobService,
  ) {}

  // ── access ───────────────────────────────────────────────────────────────

  /**
   * Owner-or-member on the dataset's workspace. 404 rather than 403 throughout:
   * confirming to an unauthorised caller that a dataset exists is itself a leak.
   */
  private async assertDatasetAccess(datasetId: string, user: Auth.UserPayload) {
    // ADMIN bypasses membership, exactly as dataset.authorized.service.ts:70
    // does for the CRUD routes. The two rules MUST agree: they did not until
    // now, so an ADMIN who is not a member of a workspace could create a
    // dataset there (allowed by the CRUD rule) and then never store its rows
    // (404 by this one) — a dataset permanently stuck without an artifact,
    // seen as "Dataset saved, but its rows could not be stored: Dataset not
    // found".
    const isAdmin = user.role === 'ADMIN';
    const dataset = await this.prisma.dataset.findFirst({
      where: {
        id: datasetId,
        workspace: {
          deletedAt: null,
          ...(isAdmin
            ? {}
            : {
                OR: [
                  { ownerId: user.id },
                  { members: { some: { userId: user.id } } },
                ],
              }),
        },
      },
    });
    if (!dataset) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset not found',
        type: 'ERROR',
      });
    }
    return dataset;
  }

  private async findVersion(datasetId: string, versionId: string) {
    const version = await this.prisma.datasetVersion.findFirst({
      where: { id: versionId, datasetId },
    });
    if (!version) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset version not found',
        type: 'ERROR',
      });
    }
    return version;
  }

  // ── versions ─────────────────────────────────────────────────────────────

  async listVersionsService(user: Auth.UserPayload, datasetId: string) {
    await this.assertDatasetAccess(datasetId, user);
    const items = await this.prisma.datasetVersion.findMany({
      where: { datasetId },
      orderBy: { versionNumber: 'asc' },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });

    return {
      statusCode: 200,
      message: 'Dataset versions fetched successfully',
      type: 'SUCCESS' as const,
      data: items.map((item) => ({
        id: item.id,
        datasetId: item.datasetId,
        parentVersionId: item.parentVersionId,
        versionNumber: item.versionNumber,
        stage: item.stage,
        rowCount: item.rowCount,
        columnCount: item.columnCount,
        missingPct: item.missingPct,
        sizeBytes: item.sizeBytes,
        operations: item.operations,
        durationMs: item.durationMs,
        createdAt: item.createdAt.toISOString(),
        createdBy:
          [item.createdBy.firstName, item.createdBy.lastName]
            .filter(Boolean)
            .join(' ') || 'Unknown',
      })),
    };
  }

  /**
   * Materialize V1 (raw) — fetch from the source and write the first artifact.
   *
   * Runs INLINE rather than as a job: a fetch is a single connector call with
   * no intermediate steps to report, so a job row would add a state machine
   * without adding information. Bounded by `PYTHON_TIMEOUT.preprocess`.
   */
  async createRawVersionService(
    user: Auth.UserPayload,
    datasetId: string,
    dto: CreateRawVersionDto,
  ) {
    const dataset = await this.assertDatasetAccess(datasetId, user);

    // Restricted to the dataset's OWN sources. Access is asserted on the
    // dataset, but the secret decrypted in buildSourceBlock belongs to the
    // DataSource — so an unconstrained lookup would let any caller holding one
    // dataset name an arbitrary source id and have the server connect with that
    // source's credentials. DataSource carries no workspaceId, so the recipe's
    // own source list is both the tightest scope available and the correct one:
    // materialising replays that recipe, nothing else.
    const source = dataset.sourceIds.includes(dto.sourceId)
      ? await this.prisma.dataSource.findFirst({ where: { id: dto.sourceId } })
      : null;
    if (!source) {
      throw new AppException({
        statusCode: 404,
        message: 'Data source not found',
        type: 'ERROR',
      });
    }

    const versionId = randomUUID();
    const startedAt = Date.now();

    const stats = ArtifactStatsSchema.parse(
      await postToPython(
        '/v1/preprocess/materialize',
        {
          target_key: `${datasetId}/${versionId}.parquet`,
          ...this.buildSourceBlock(source, dto),
        },
        PYTHON_TIMEOUT.preprocess,
      ),
    );

    // Version row and the dataset's pointer to it, together: a committed
    // artifact the dataset does not point at is invisible to every read path.
    const version = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.datasetVersion.findFirst({
        where: { datasetId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const created = await tx.datasetVersion.create({
        data: {
          id: versionId,
          datasetId,
          versionNumber: (previous?.versionNumber ?? 0) + 1,
          stage: 'RAW',
          objectKey: stats.object_key,
          rowCount: stats.row_count,
          columnCount: stats.column_count,
          missingPct: stats.missing_pct,
          sizeBytes: stats.size_bytes,
          // A raw version is produced by a FETCH, not by operations.
          operations: [],
          durationMs: Date.now() - startedAt,
          createdById: user.id,
        },
      });
      await tx.dataset.update({
        where: { id: datasetId },
        data: { currentVersionId: created.id },
      });
      return created;
    });

    return {
      statusCode: 201,
      message: 'Raw dataset version created successfully',
      type: 'SUCCESS' as const,
      data: {
        id: version.id,
        versionNumber: version.versionNumber,
        stage: version.stage,
        rowCount: version.rowCount,
        columnCount: version.columnCount,
        missingPct: version.missingPct,
      },
    };
  }

  /**
   * Map a stored DataSource onto the connector's credential contract.
   *
   * The secret is decrypted here and lives only for the duration of the call —
   * the same handling as `data-source.connect.service.ts`. It is never returned
   * to the browser and never logged. Note that the browser cannot supply
   * credentials on this route at all: `CreateRawVersionSchema` has no field for
   * them, deliberately.
   */
  private buildSourceBlock(
    source: {
      type: string;
      host: string;
      username: string;
      dbName: string;
      secretCiphertext: string;
      config: PrismaTypes.JsonValue;
    },
    dto: CreateRawVersionDto,
  ) {
    const secret = decryptSecret(source.secretCiphertext);

    if (source.type === 'aveva') {
      return {
        pi: {
          credentials: {
            api_server: source.host,
            pi_server: source.dbName,
            user: source.username,
            password: secret,
          },
          tag_list: dto.tags,
          start_time: dto.startTime,
          end_time: dto.endTime,
          ...(dto.summaryDuration && { summary_duration: dto.summaryDuration }),
        },
      };
    }

    if (source.type === 'sql') {
      if (!dto.timestampColumn || !dto.table) {
        throw new AppException({
          statusCode: 400,
          message:
            'A SQL source needs `table` and `timestampColumn` — the canonical ' +
            'frame is built around a declared time axis.',
          type: 'ERROR',
        });
      }
      // Per schema.prisma, `config` holds the non-secret {port, driver} for
      // SQL sources.
      const config = (source.config ?? {}) as {
        port?: number;
        driver?: string;
      };
      return {
        sql: {
          query: {
            credentials: {
              driver: config.driver ?? 'postgres',
              host: source.host,
              port: config.port ?? 5432,
              database: source.dbName,
              user: source.username,
              password: secret,
            },
            table: dto.table,
            time_column: dto.timestampColumn,
            start_time: dto.startTime,
            end_time: dto.endTime,
          },
          timestamp_column: dto.timestampColumn,
          tags: dto.tags,
        },
      };
    }

    throw new AppException({
      statusCode: 400,
      message: `Source type '${source.type}' cannot be materialized yet.`,
      type: 'ERROR',
    });
  }

  // ── rows + preview ───────────────────────────────────────────────────────

  async listRowsService(
    user: Auth.UserPayload,
    datasetId: string,
    versionId: string,
    query: ListRowsDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const version = await this.findVersion(datasetId, versionId);

    const page = PythonRowsSchema.parse(
      await postToPython(
        '/v1/preprocess/rows',
        {
          source_key: version.objectKey,
          offset: query.offset,
          limit: query.limit,
        },
        PYTHON_TIMEOUT.fetch,
      ),
    );

    return {
      statusCode: 200,
      message: 'Rows fetched successfully',
      type: 'SUCCESS' as const,
      data: {
        totalRowCount: page.total_row_count,
        offset: page.offset,
        tags: page.tags,
        rows: page.rows,
      },
    };
  }

  /** Preview writes nothing — no job, no version row, no object. */
  async previewService(
    user: Auth.UserPayload,
    datasetId: string,
    versionId: string,
    dto: PreviewVersionDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const version = await this.findVersion(datasetId, versionId);

    const preview = PythonPreviewSchema.parse(
      await postToPython(
        '/v1/preprocess/preview',
        {
          source_key: version.objectKey,
          operations: dto.operations,
          precision: dto.precision,
          ...(dto.sampleRows && { sample_rows: dto.sampleRows }),
          ...(dto.previewRows && { preview_rows: dto.previewRows }),
        },
        PYTHON_TIMEOUT.metadata,
      ),
    );

    return {
      statusCode: 200,
      message: 'Preview generated successfully',
      type: 'SUCCESS' as const,
      data: preview,
    };
  }

  // ── jobs ─────────────────────────────────────────────────────────────────

  /**
   * Queue a cleaning job and return immediately. The HTTP request must not wait
   * on the pipeline (CLAUDE.md §5) — the controller answers 202 and the client
   * polls the job for progress.
   */
  async startCleanJobService(
    user: Auth.UserPayload,
    datasetId: string,
    versionId: string,
    dto: StartCleanJobDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    await this.findVersion(datasetId, versionId);

    const job = await this.prisma.preprocessingJob.create({
      data: {
        datasetId,
        sourceVersionId: versionId,
        status: 'QUEUED',
        stage: 'CLEAN',
        totalSteps: dto.operations.length,
        // Precision travels WITH the operations: it is part of the recipe that
        // produced a version, and a replay without it rounds differently.
        operations: {
          operations: dto.operations,
          precision: dto.precision,
        },
        createdById: user.id,
      },
    });

    this.jobs.start(job.id);

    return {
      statusCode: 202,
      message: 'Cleaning job accepted',
      type: 'SUCCESS' as const,
      data: { jobId: job.id, status: job.status },
    };
  }

  async getJobService(
    user: Auth.UserPayload,
    datasetId: string,
    jobId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const job = await this.prisma.preprocessingJob.findFirst({
      where: { id: jobId, datasetId },
    });
    if (!job) {
      throw new AppException({
        statusCode: 404,
        message: 'Job not found',
        type: 'ERROR',
      });
    }

    return {
      statusCode: 200,
      message: 'Job fetched successfully',
      type: 'SUCCESS' as const,
      data: {
        id: job.id,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        currentStep: job.currentStep,
        totalSteps: job.totalSteps,
        completedSteps: job.completedSteps,
        estimatedRemainingMs: job.estimatedRemainingMs,
        error: job.error,
        attempts: job.attempts,
        sourceVersionId: job.sourceVersionId,
        resultVersionId: job.resultVersionId,
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      },
    };
  }

  async cancelJobService(
    user: Auth.UserPayload,
    datasetId: string,
    jobId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const job = await this.prisma.preprocessingJob.findFirst({
      where: { id: jobId, datasetId },
    });
    if (!job) {
      throw new AppException({
        statusCode: 404,
        message: 'Job not found',
        type: 'ERROR',
      });
    }
    if (job.status !== 'RUNNING' && job.status !== 'QUEUED') {
      throw new AppException({
        statusCode: 409,
        message: `Job is already ${job.status.toLowerCase()} and cannot be canceled.`,
        type: 'ERROR',
      });
    }

    const aborted = this.jobs.cancel(jobId);
    if (!aborted) {
      // QUEUED but not yet started, or a leftover this process does not own.
      // Marked terminal directly so it cannot be polled forever.
      await this.prisma.preprocessingJob.update({
        where: { id: jobId },
        data: {
          status: 'CANCELED',
          error: 'Canceled before the job started.',
          finishedAt: new Date(),
        },
      });
    }

    return {
      statusCode: 200,
      message: 'Job canceled',
      type: 'SUCCESS' as const,
      data: { jobId, status: 'CANCELED' as const },
    };
  }

  /**
   * Retry creates a NEW job rather than resetting the old one.
   *
   * Two reasons, both load-bearing: the failed attempt stays on the record, and
   * the new run mints a fresh versionId. Reusing the old one risks colliding
   * with an orphan artifact the failed run already wrote to that immutable key.
   */
  async retryJobService(
    user: Auth.UserPayload,
    datasetId: string,
    jobId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const previous = await this.prisma.preprocessingJob.findFirst({
      where: { id: jobId, datasetId },
    });
    if (!previous) {
      throw new AppException({
        statusCode: 404,
        message: 'Job not found',
        type: 'ERROR',
      });
    }
    if (previous.status !== 'FAILED' && previous.status !== 'CANCELED') {
      throw new AppException({
        statusCode: 409,
        message: 'Only a failed or canceled job can be retried.',
        type: 'ERROR',
      });
    }

    const job = await this.prisma.preprocessingJob.create({
      data: {
        datasetId,
        sourceVersionId: previous.sourceVersionId,
        status: 'QUEUED',
        stage: previous.stage,
        totalSteps: previous.totalSteps,
        operations: previous.operations as PrismaTypes.InputJsonValue,
        // The runner increments on start, so the new row carries the previous
        // count forward rather than restarting at zero.
        attempts: previous.attempts,
        createdById: user.id,
      },
    });

    this.jobs.start(job.id);

    return {
      statusCode: 202,
      message: 'Retry accepted',
      type: 'SUCCESS' as const,
      data: { jobId: job.id, status: job.status, retryOf: previous.id },
    };
  }
}
