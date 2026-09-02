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
