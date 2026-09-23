import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { verifyModelObject } from '@/lib/python-preprocess-client';
import { isPromotable } from '@/lib/model-version-transitions';
import type {
  PromoteVersionDto,
  RollbackModelDto,
} from './dto/model-version.authorized.dto';

/** MODEL-SERVE-001-T06. `r2 <= 0` is a hard block; `null`/unreadable (no
 *  `metrics`, or `metrics.r2` not a finite number) is treated the SAME as a
 *  failing score, never as a silent pass — an unknown r2 is not evidence the
 *  model is good. Same narrowing convention `extractRmse` (model-candidate-
 *  job.authorized.service.ts) uses for its own untyped Json metrics. */
function extractR2(metrics: unknown): number | null {
  if (!metrics || typeof metrics !== 'object') return null;
  const r2 = (metrics as Record<string, unknown>).r2;
  return typeof r2 === 'number' && Number.isFinite(r2) ? r2 : null;
}

/**
 * MODEL-SERVE-001. Promote/rollback for the `ModelVersion` registry — see
 * that model's own doc comment in schema.prisma for the row shape and
 * MODEL-SERVE-001's ledger entry for the decisions this implements.
 *
 * Lives as its own module (mirroring `dataset-version`'s relationship to
 * `dataset`) rather than folded into `ModelAuthorizedService` — a promote
 * and a Model CRUD edit are different operations with different guards
 * (T05's live object-verification call, T06's r2 floor), and the codebase
 * convention (model-run, model-draft, model-draft-cleanup are all their own
 * modules despite being tightly coupled to Model) already treats
 * one-feature-per-module as the norm here.
 */
@Injectable()
export class ModelVersionAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  // ── access ───────────────────────────────────────────────────────────────

  /** Editor-level, same rule `ModelAuthorizedService.assertCanEdit` applies
   *  to every other mutating Model route — promoting or rolling back what
   *  answers live traffic is not a read. */
  private async assertModelAccess(modelId: string, user: Auth.UserPayload) {
    const model = await this.prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, workspaceId: true },
    });
    if (!model) {
      throw new AppException({
        statusCode: 404,
        message: 'Model not found',
        type: 'ERROR',
      });
    }
    if (user.role === 'ADMIN') return model;

    const workspace = await this.prisma.workspace.findFirst({
      where: { id: model.workspaceId, ownerId: user.id },
      select: { id: true },
    });
    if (workspace) return model;
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: model.workspaceId, userId: user.id },
    });
    if (!member || member.role === 'VIEWER') {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden: editor access required',
        type: 'ERROR',
      });
    }
    return model;
  }

  private isUniqueViolation(err: unknown, constraint?: string): boolean {
    if (
      !(err instanceof PrismaTypes.PrismaClientKnownRequestError) ||
      err.code !== 'P2002'
    ) {
      return false;
    }
    if (!constraint) return true;
    const target = (err.meta as { target?: unknown } | undefined)?.target;
    const targetStr = Array.isArray(target)
      ? target.join(',')
      : typeof target === 'string'
        ? target
        : '';
    return targetStr.includes(constraint);
  }

  /**
   * T04/T05/T06. Shared by `promoteVersionService` and `rollbackService` —
   * rollback IS a promote pointed at the previous PRODUCTION version, not a
   * distinct mechanism (MODEL-SERVE-001-T04's own decision), so both funnel
   * through exactly this gate rather than rollback getting a looser path.
   */
  private async promote(
    modelId: string,
    version: {
      id: string;
      stage: 'STAGING' | 'PRODUCTION' | 'ARCHIVED';
      modelObjectKey: string;
      modelChecksum: string | null;
      metrics: unknown;
    },
    user: Auth.UserPayload,
    override: { reason: string } | undefined,
  ) {
    if (version.stage === 'PRODUCTION') {
      // Idempotent no-op — same policy split `isLegalTransition`'s own doc
      // comment describes for a same-state dataset-version request. A
      // client retrying after a dropped response should not get a 422 for
      // a state that is already correct.
      return version;
    }
    if (!isPromotable(version.stage)) {
      // Unreachable with today's 3-stage enum (STAGING/ARCHIVED both true,
      // PRODUCTION handled above) — kept so a future stage added to the
      // enum without updating this predicate fails loudly here rather than
      // silently promoting.
      throw new AppException({
        statusCode: 422,
        message: `Version is ${version.stage} and cannot be promoted.`,
        type: 'ERROR',
      });
    }

    // T05. Verified BEFORE flipping the stage — a promote that succeeds
    // against a missing or altered object turns a deploy into an outage
    // discovered by the first request, and the rollback path is then also
    // untested.
    const verified = await verifyModelObject(version.modelObjectKey);
    if (!verified.exists) {
      throw new AppException({
        statusCode: 422,
        message:
          `Cannot promote: model object ${version.modelObjectKey} no ` +
          'longer exists in object storage.',
        type: 'ERROR',
      });
    }
    if (version.modelChecksum && verified.checksum !== version.modelChecksum) {
      throw new AppException({
        statusCode: 422,
        message:
          `Cannot promote: model object ${version.modelObjectKey} checksum ` +
          `has changed (expected ${version.modelChecksum}, found ` +
          `${verified.checksum ?? 'null'}).`,
        type: 'ERROR',
      });
    }

    // T06. r2 <= 0, or unreadable, is a hard block unless overridden with a
    // recorded reason — see extractR2's own comment for why "unknown" is
    // never treated as a pass.
    const r2 = extractR2(version.metrics);
    const passesFloor = r2 !== null && r2 > 0;
    let promotionOverride: Record<string, unknown> | undefined;
    if (!passesFloor) {
      if (!override?.reason) {
        throw new AppException({
          statusCode: 422,
          message:
            (r2 === null
              ? 'Cannot promote: this version has no readable r2 metric.'
              : `Cannot promote: r2 (${r2}) is at or below zero.`) +
            ' Provide an override reason to promote it anyway.',
          type: 'ERROR',
        });
      }
      // Same firstName/lastName-then-fallback resolution
      // `updateModelService`'s `editorName` already uses for its own
      // audit-trail entries — the same identity string the rest of the
      // Model audit trail records, not the caller's login email.
      const actor = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { firstName: true, lastName: true },
      });
      const actorName =
        [actor?.firstName, actor?.lastName].filter(Boolean).join(' ').trim() ||
        user.email;
      promotionOverride = {
        actorId: user.id,
        actorName,
        reason: override.reason,
        at: new Date().toISOString(),
      };
    }

    const now = new Date();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const currentProduction = await tx.modelVersion.findFirst({
          where: { modelId, stage: 'PRODUCTION' },
          select: { id: true },
        });
        if (currentProduction && currentProduction.id !== version.id) {
          await tx.modelVersion.update({
            where: { id: currentProduction.id },
            data: { stage: 'ARCHIVED', archivedAt: now },
          });
        }
        return tx.modelVersion.update({
          where: { id: version.id },
          data: {
            stage: 'PRODUCTION',
            promotedById: user.id,
            promotedAt: now,
            archivedAt: null,

            ...(promotionOverride && {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              promotionOverride: JSON.parse(JSON.stringify(promotionOverride)),
            }),
          },
        });
      });
    } catch (err) {
      // Two concurrent promotes racing past the read above both reach this
      // transaction; the partial unique index (`ModelVersion_one_
      // production_per_model`) is the actual backstop — exactly one commits,
      // the other's UPDATE fails here and rolls back, leaving the
      // previously-live version untouched. Checked by constraint NAME, not
      // just P2002, so this never masks a genuinely different unique
      // violation (e.g. a racing second version at the same modelId+version
      // number) under a misleading "already being promoted" message.
      if (
        this.isUniqueViolation(err, 'ModelVersion_one_production_per_model')
      ) {
        throw new AppException({
          statusCode: 409,
          message:
            'Another promote for this model committed first — retry if ' +
            'this version should still become PRODUCTION.',
          type: 'ERROR',
        });
      }
      throw err;
    }
  }

  /**
   * MODEL-SERVE-016-T01. Enumerate a model's versions with the metrics each
   * one FROZE at creation time.
   *
   * Nothing listed versions before this: the registry shipped with promote
   * and rollback only, so a client could move PRODUCTION to a version it had
   * no way to discover. Same `assertModelAccess` guard those two already
   * call — one authorization path, not a second one written for a read.
   *
   * `metrics` is Json on the row and is READ DEFENSIVELY. Legacy versions
   * predate today's shape, and a partially-written object is indistinguishable
   * from a complete one at the type level, so each key is resolved
   * independently and a missing or non-finite value becomes `null`. Never 0:
   * an RMSE of 0 is a perfect model, which is exactly the wrong thing to
   * render for "we do not know".
   */
  async listVersionsService(user: Auth.UserPayload, modelId: string) {
    await this.assertModelAccess(modelId, user);

    const versions = await this.prisma.modelVersion.findMany({
      where: { modelId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        stage: true,
        algorithm: true,
        metrics: true,
        retrainStrategy: true,
        createdAt: true,
        archivedAt: true,
      },
    });

    return {
      statusCode: 200,
      message: 'Model versions fetched',
      type: 'SUCCESS' as const,
      data: {
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          stage: v.stage,
          algorithm: v.algorithm,
          retrainStrategy: v.retrainStrategy,
          createdAt: v.createdAt.toISOString(),
          archivedAt: v.archivedAt?.toISOString() ?? null,
          metrics: readTrainingMetrics(v.metrics),
        })),
      },
    };
  }

  async promoteVersionService(
    user: Auth.UserPayload,
    modelId: string,
    versionNumber: number,
    dto: PromoteVersionDto,
  ) {
    await this.assertModelAccess(modelId, user);
    const version = await this.prisma.modelVersion.findFirst({
      where: { modelId, version: versionNumber },
    });
    if (!version) {
      throw new AppException({
        statusCode: 404,
        message: `Model version ${versionNumber} not found`,
        type: 'ERROR',
      });
    }

    const promoted = await this.promote(modelId, version, user, dto.override);
    return {
      statusCode: 200,
      message:
        promoted.stage === version.stage && version.stage === 'PRODUCTION'
          ? 'Version is already PRODUCTION'
          : 'Version promoted to PRODUCTION',
      type: 'SUCCESS' as const,
      data: promoted,
    };
  }

  /**
   * MODEL-SERVE-017-T01. Permanently remove a version the user has decided
   * not to deploy.
   *
   * WHAT IT REFUSES, AND WHY EACH ONE IS A SERVER RULE RATHER THAN A UI
   * ONE. The tab only offers the button on a STAGING row, but "not
   * PRODUCTION" is two different populations and only one of them is safe:
   *
   * 1. PRODUCTION — is answering traffic right now. Deleting it is an
   *    outage.
   * 2. `promotedAt !== null` — has served at some point, so it is ARCHIVED,
   *    and the most recently archived such row is EXACTLY what
   *    `rollbackService` resolves as "the previous PRODUCTION version".
   *    Deleting it silently re-points rollback at an older version with no
   *    error anywhere; that is a correctness regression, not a tidy-up.
   * 3. Any prediction job, prediction log or inference window pinned to it.
   *    Those FKs are `NoAction` (see ModelVersion's own schema comment for
   *    why they are not Restrict), so the delete would fail at the DB with
   *    a constraint name instead of a sentence. Counted first so the
   *    refusal can say what is holding the version.
   *
   * THE OBJECT STORAGE BYTES ARE LEFT ALONE. `modelObjectKey` and
   * `goldObjectKey` are pinned copies of the SOURCE RUN's artifacts, not
   * this row's private property — the ModelTrainingRun still points at
   * them, and MODEL-SERVE-000-T07 found no GC policy in this repo to model
   * a deletion path on. Dropping the row is the smallest change that is
   * certainly correct; reclaiming bytes is a separate decision.
   *
   * `ModelCandidateJob.resultVersionId` is a bare String, not an FK, so a
   * retrain job that minted this version keeps a dangling id. That read
   * (`model-retrain.authorized.service.ts`) is already a `findUnique` whose
   * null branch renders "no version yet", so it degrades to that rather
   * than throwing — the honest answer once the version is gone.
   */
  async removeVersionService(
    user: Auth.UserPayload,
    modelId: string,
    versionNumber: number,
  ) {
    await this.assertModelAccess(modelId, user);

    const version = await this.prisma.modelVersion.findFirst({
      where: { modelId, version: versionNumber },
      select: { id: true, version: true, stage: true, promotedAt: true },
    });
    if (!version) {
      throw new AppException({
        statusCode: 404,
        message: `Model version ${versionNumber} not found`,
        type: 'ERROR',
      });
    }

    if (version.stage === 'PRODUCTION') {
      throw new AppException({
        statusCode: 422,
        message:
          `Cannot remove v${version.version}: it is serving production ` +
          'traffic. Promote another version first.',
        type: 'ERROR',
      });
    }

    if (version.promotedAt !== null) {
      throw new AppException({
        statusCode: 422,
        message:
          `Cannot remove v${version.version}: it has been in production ` +
          'before and is kept as a rollback target.',
        type: 'ERROR',
      });
    }

    const [jobs, logs, windows] = await Promise.all([
      this.prisma.predictionJob.count({
        where: { modelVersionId: version.id },
      }),
      this.prisma.predictionLog.count({
        where: { modelVersionId: version.id },
      }),
      this.prisma.inferenceWindow.count({
        where: { modelVersionId: version.id },
      }),
    ]);
    if (jobs > 0 || logs > 0 || windows > 0) {
      const held = [
        jobs > 0 ? `${jobs} prediction job(s)` : null,
        logs > 0 ? `${logs} prediction log(s)` : null,
        windows > 0 ? `${windows} inference window(s)` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(', ');
      throw new AppException({
        statusCode: 422,
        message: `Cannot remove v${version.version}: ${held} still reference it.`,
        type: 'ERROR',
      });
    }

    // The checks above race a concurrent promote or a scheduler writing the
    // first window. The FK is the real backstop; if it fires the row simply
    // stays, which is the safe outcome, and the client sees a refusal
    // rather than a phantom success.
    try {
      await this.prisma.modelVersion.delete({ where: { id: version.id } });
    } catch (err) {
      if (
        err instanceof PrismaTypes.PrismaClientKnownRequestError &&
        // P2003 (FK violation), P2014 (the delete would break a required
        // relation — what Prisma raises for some shapes of the same race)
        // and P2025 (the row went first). All three mean "the world moved",
        // none of them means a bug worth a 500.
        (err.code === 'P2003' || err.code === 'P2014' || err.code === 'P2025')
      ) {
        throw new AppException({
          statusCode: 422,
          message:
            `Could not remove v${version.version} — it changed while the ` +
            'request was in flight. Reload the versions list and retry.',
          type: 'ERROR',
        });
      }
      throw err;
    }

    return {
      statusCode: 200,
      message: `Version ${version.version} removed`,
      type: 'SUCCESS' as const,
      data: { id: version.id, version: version.version },
    };
  }

  /**
   * T04. Rollback is promote pointed at the previous PRODUCTION version —
   * "previous" meaning the most recently ARCHIVED row for this model, per
   * `archivedAt` descending (the column `ModelVersion`'s own schema comment
   * names for exactly this lookup).
   */
  async rollbackService(
    user: Auth.UserPayload,
    modelId: string,
    dto: RollbackModelDto,
  ) {
    await this.assertModelAccess(modelId, user);
    // `promotedAt: { not: null }`, not just `stage: 'ARCHIVED'` — the
    // invariant this method's name promises ("the PREVIOUS PRODUCTION
    // version") must hold by construction, not by the accident that only
    // `promote()` writes ARCHIVED today. `promotedAt` is set ONLY by
    // `promote()`'s own transaction, so a version that reaches ARCHIVED by
    // some future path without ever having been PRODUCTION (a stale-STAGING
    // sweep, a manual admin action) is correctly excluded here rather than
    // silently becoming a rollback target that never served traffic.
    const previous = await this.prisma.modelVersion.findFirst({
      where: {
        modelId,
        stage: 'ARCHIVED',
        archivedAt: { not: null },
        promotedAt: { not: null },
      },
      orderBy: { archivedAt: 'desc' },
    });
    if (!previous) {
      throw new AppException({
        statusCode: 422,
        message: 'No previous PRODUCTION version to roll back to.',
        type: 'ERROR',
      });
    }

    const promoted = await this.promote(modelId, previous, user, dto.override);
    return {
      statusCode: 200,
      message: `Rolled back to version ${previous.version}`,
      type: 'SUCCESS' as const,
      data: promoted,
    };
  }
}

/**
 * MODEL-SERVE-016-T01. The three headline numbers out of an untyped
 * `ModelVersion.metrics` blob, each resolved on its own so a partial object
 * yields partial truth rather than being discarded whole.
 *
 * NaN and Infinity are treated as absent: both are reachable from a real
 * training run (an R2 over a constant target divides by zero) and both
 * serialize to `null` through JSON anyway, so admitting them would only
 * move the problem to the client.
 */
function readTrainingMetrics(raw: unknown): {
  rmse: number | null;
  r2: number | null;
  mae: number | null;
} {
  const source =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

  return {
    rmse: num(source.rmse),
    r2: num(source.r2),
    mae: num(source.mae),
  };
}
