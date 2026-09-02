import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { getRunManifest } from '@/lib/python-preprocess-client';
import { ModelConfigSchema } from '@/api/v1/model/authorized/dto/model.authorized.dto';
import {
  type CreateModelDraftDto,
  type ListModelDraftQueryDto,
  type PatchModelDraftDto,
  type SaveModelDraftDto,
} from './dto/model-draft.authorized.dto';

/** Same include `model.authorized.service.ts`'s `NODE_INCLUDE` uses — kept as
 *  its own small copy rather than a cross-module import of a private const,
 *  so a saved Model's response shape matches `createModelService`'s exactly
 *  (`AIModel.nodes` on the client expects this shape). */
const NODE_INCLUDE = {
  nodes: {
    select: {
      id: true,
      data: true,
      planId: true,
      plan: { select: { id: true, name: true } },
    },
  },
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * ModelDraft — the Model Creation wizard's server-side owner while no
 * `Model` row exists yet (MODEL-FLOW-002, see decisions.draft_persistence
 * and CLAUDE.md §8). A training container has no browser: it authenticates
 * with a run token hashed into a `ModelTrainingRun` row, reads its spec
 * from `/claim`, and writes logs/metrics back over HTTP — none of which a
 * client-only jotai draft can serve. This is the row it reads instead.
 *
 * Mirrors `DatasetDraftAuthorizedService`'s access-control shape closely —
 * `assertModelAccess` (model-run-launch.authorized.service.ts) cannot be
 * reused here, both because it resolves through `model.workspaceId` (no
 * Model exists pre-Save) and because its own comment documents the
 * module-cycle constraint that blocks importing it directly.
 */
@Injectable()
export class ModelDraftAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  // ── access ───────────────────────────────────────────────────────────────

  /**
   * The one owner-or-member workspace filter every route here scopes by.
   * Extracted so the list (MODEL-FLOW-010-T08) filters by exactly the clause
   * the single-draft asserts already enforce — a second, hand-written copy is
   * how a list ends up broader than the GET it links to.
   */
  private workspaceScope(user: Auth.UserPayload) {
    const isAdmin = user.role === 'ADMIN';
    return {
      deletedAt: null,
      ...(isAdmin
        ? {}
        : {
            OR: [
              { ownerId: user.id },
              { members: { some: { userId: user.id } } },
            ],
          }),
    };
  }

  private async assertWorkspaceAccess(
    workspaceId: string,
    user: Auth.UserPayload,
  ) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, ...this.workspaceScope(user) },
      select: { id: true },
    });
    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }
  }

  /** Owner-or-member on the draft's workspace, matching assertDraftAccess. */
  private async assertDraftAccess(draftId: string, user: Auth.UserPayload) {
    const draft = await this.prisma.modelDraft.findFirst({
      where: { id: draftId, workspace: this.workspaceScope(user) },
    });
    if (!draft) {
      throw new AppException({
        statusCode: 404,
        message: 'Model draft not found',
        type: 'ERROR',
      });
    }
    return draft;
  }

  // ── draft lifecycle ──────────────────────────────────────────────────────

  async createDraftService(user: Auth.UserPayload, dto: CreateModelDraftDto) {
    await this.assertWorkspaceAccess(dto.workspaceId, user);
    const draft = await this.prisma.modelDraft.create({
      data: {
        workspaceId: dto.workspaceId,
        name: dto.name,
        plantId: dto.plantId,
        nodeId: dto.nodeId,
        datasetId: dto.datasetId,
        createdById: user.id,
      },
    });

    return {
      statusCode: 201,
      message: 'Model draft created successfully',
      type: 'SUCCESS' as const,
      data: this.mapDraft(draft),
    };
  }

  /**
   * Drafts the user can reach, newest-touched first (MODEL-FLOW-010-T08) —
   * the only way back into a wizard the user left to go and edit a dataset.
   *
   * Both filters are optional and neither widens access: the workspace scope
   * is applied regardless, so an unfiltered call lists the caller's own
   * drafts rather than everyone's. `updatedAt` orders it because that is what
   * "the one I was just in" means to the user; `createdAt` would bury a
   * long-running draft under fresher abandoned ones.
   */
  async listDraftsService(
    user: Auth.UserPayload,
    query: ListModelDraftQueryDto,
  ) {
    // Explicit 404 for an inaccessible workspace rather than an empty list:
    // asking for a workspace that is not yours is a different fact from
    // having no drafts in one that is.
    if (query.workspaceId) {
      await this.assertWorkspaceAccess(query.workspaceId, user);
    }

    const drafts = await this.prisma.modelDraft.findMany({
      where: {
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.status ? { status: query.status } : {}),
        workspace: this.workspaceScope(user),
      },
      orderBy: { updatedAt: 'desc' },
    });

    return {
      statusCode: 200,
      message: 'Model drafts fetched successfully',
      type: 'SUCCESS' as const,
      data: drafts.map((draft) => this.mapDraft(draft)),
    };
  }

  async getDraftService(user: Auth.UserPayload, draftId: string) {
    const draft = await this.assertDraftAccess(draftId, user);
    const resolvedRunId = await this.resolveActiveRunId(draft);
    return {
      statusCode: 200,
      message: 'Model draft fetched successfully',
      type: 'SUCCESS' as const,
      data: { ...this.mapDraft(draft), resolvedRunId },
    };
  }

  /**
   * MODEL-FLOW-013-T08. `selectedRunId ?? bestRunId` from the draft's most
   * recent TERMINAL candidate job (a user's override, or the metric's own
   * winner) — falling back to the draft's own `currentRunId` (an ordinary
   * single-run launch, or a job whose completion branch already wrote the
   * winner there, unchanged by this feature) when no such job exists, or
   * the most recent one is still QUEUED/RUNNING.
   *
   * ONE resolver: `currentRunId` keeps its existing single writer
   * (`advanceJobForRun`'s completion branch in
   * model-candidate-job.authorized.service.ts) — this is a READ, never a
   * write, so a later user selection changes what callers see without a
   * second writer ever touching `currentRunId` itself. Evaluation
   * (`useDraftRunEvaluation`'s `resolveRunId`) reads this field; Save Model
   * adoption (MODEL-FLOW-007-T10, unbuilt) is expected to read it too.
   */
  private async resolveActiveRunId(draft: {
    id: string;
    currentRunId: string | null;
  }): Promise<string | null> {
    const job = await this.prisma.modelCandidateJob.findFirst({
      where: { modelDraftId: draft.id },
      orderBy: { createdAt: 'desc' },
      select: { status: true, selectedRunId: true, bestRunId: true },
    });
    if (
      job &&
      (job.status === 'SUCCEEDED' ||
        job.status === 'FAILED' ||
        job.status === 'CANCELED')
    ) {
      const resolved = job.selectedRunId ?? job.bestRunId;
      if (resolved) return resolved;
    }
    return draft.currentRunId;
  }

  /**
   * Whichever fields changed, not the whole config — Step 2 debounces this
   * per edit. Refuses (409) once the draft is SAVED: an already-adopted
   * draft's config must not keep drifting after the Model it fed exists.
   *
   * MODEL-FLOW-011: also refuses ABANDONED, for the open-tab case a sweep
   * introduces. Before this, a draft the sweep abandoned while the wizard
   * sat open kept accepting the debounced PATCH (into
   * useModelDraftSync's silent catch) — the user would learn nothing until
   * Start Training refused the row for a completely different reason
   * (assertDraftWritableStatus). Refusing here surfaces it at the very next
   * edit instead.
   */
  async patchDraftService(
    user: Auth.UserPayload,
    draftId: string,
    dto: PatchModelDraftDto,
  ) {
    const existing = await this.assertDraftAccess(draftId, user);
    if (existing.status === 'SAVED') {
      throw new AppException({
        statusCode: 409,
        message:
          'Draft has already been saved as a Model — its configuration ' +
          'can no longer be edited.',
        type: 'ERROR',
      });
    }
    if (existing.status === 'ABANDONED') {
      throw new AppException({
        statusCode: 409,
        message:
          'This draft was abandoned (idle too long, or removed) and can no ' +
          'longer be edited. Start a new model from Step 1.',
        type: 'ERROR',
      });
    }
    const draft = await this.prisma.modelDraft.update({
      where: { id: draftId },
      data: {
        name: dto.name,
        plantId: dto.plantId,
        nodeId: dto.nodeId,
        datasetId: dto.datasetId,
        targetY: dto.targetY,
        algorithm: dto.algorithm,
        hyperparameters: dto.hyperparameters,
        splitRatio: dto.splitRatio,
      },
    });
    return {
      statusCode: 200,
      message: 'Model draft updated successfully',
      type: 'SUCCESS' as const,
      data: this.mapDraft(draft),
    };
  }

  /**
   * Abandon rather than delete: the runs the draft owns stay in Postgres —
   * only the draft's own status changes, so a stale wizard tab that keeps
   * polling gets an honest ABANDONED rather than a 404 for a row that
   * vanished under it. Mirrors abandonDraftService's own rationale.
   */
  async abandonDraftService(user: Auth.UserPayload, draftId: string) {
    await this.assertDraftAccess(draftId, user);
    const draft = await this.prisma.modelDraft.update({
      where: { id: draftId },
      data: { status: 'ABANDONED' },
    });
    return {
      statusCode: 200,
      message: 'Model draft abandoned',
      type: 'SUCCESS' as const,
      data: this.mapDraft(draft),
    };
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof PrismaTypes.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
  }

  /** `ModelTrainingRun.splitSpec` is untyped Json — `{method, ratio, ...}` at
   *  launch (`model-run-launch.authorized.service.ts`), `ratio` a FRACTION
   *  (0.5-0.95). Narrowed by hand rather than cast, per CLAUDE.md's "no any". */
  private extractSplitRatio(splitSpec: unknown): number | null {
    if (!isPlainObject(splitSpec)) return null;
    const ratio = splitSpec.ratio;
    return typeof ratio === 'number' ? ratio : null;
  }

  /**
   * MODEL-FLOW-016-T12. The adopted run's CV provenance, or `null` for an
   * ordinary chronological run — see `ModelConfigSchema.crossValidation` for
   * why a saved Model has to carry this at all.
   *
   * Read off `splitSpec`, NOT `cvFoldsKey`: `triggerScoringService` keys its
   * own CV check on `cvFoldsKey` because that is the durable typed column
   * set only by a CV run's `complete()`, but it carries no k — and k is
   * exactly what this field exists to record. `splitSpec.method` is the same
   * discriminant `SplitSpecSchema`'s discriminated union switches on, and
   * `claim()` already narrows this untyped Json the same way.
   *
   * `holdoutScored` comes from the run's own `holdoutMetrics` column rather
   * than a re-derivation: `scoreCompleteService` is its only writer, so a
   * non-null value IS the fact that the refit has a held-out number.
   */
  private extractCvConfig(
    splitSpec: unknown,
    holdoutMetrics: unknown,
  ): {
    method: 'cv_expanding';
    nSplits: number;
    holdoutScored: boolean;
  } | null {
    if (!isPlainObject(splitSpec)) return null;
    if (splitSpec.method !== 'cv_expanding') return null;
    const nSplits = splitSpec.n_splits;
    if (typeof nSplits !== 'number' || !Number.isInteger(nSplits)) return null;
    return {
      method: 'cv_expanding',
      nSplits,
      holdoutScored: holdoutMetrics != null,
    };
  }

  /** `ModelTrainingRun.hyperparameters` is untyped Json, but every value on
   *  it already passed `HyperparametersSchema` at launch — this narrows the
   *  type for `ModelConfigSchema`, it does not re-validate; a non-scalar
   *  value (unreachable today) is dropped rather than thrown, since a
   *  stricter posture here would fail a Save over a value Start Training
   *  already accepted. */
  private extractHyperparameters(
    hyperparameters: unknown,
  ): Record<string, string | number | boolean | null> {
    if (!isPlainObject(hyperparameters)) return {};
    const out: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(hyperparameters)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null
      ) {
        out[key] = value;
      }
    }
    return out;
  }

  /**
   * MODEL-FLOW-007. The ONLY route allowed to create the final persistent
   * `Model` (CLAUDE.md §13) — mirrors `saveDraftAsDatasetService`'s shape:
   * 409-on-already-SAVED, then artifact/run validation, then one
   * `$transaction`. Unlike that dataset-side save, this one does NOT copy
   * bytes: `ModelTrainingRun.modelId` is set on the winning run and its
   * objects stay at `drafts/{draftId}/runs/{runId}/...` forever — MODEL-
   * FLOW-011-T05's sweeper guard is what makes that safe (an adopted run is
   * never reclaimed).
   *
   * Config is DERIVED SERVER-SIDE from the adopted run, never trusted from
   * the client — `ModelConfigSchema`'s own comment names this as this
   * feature's job, specifically for `trainTestSplit` (a client-sent
   * percentage vs. the run's own `splitSpec.ratio` fraction).
   */
  async saveDraftService(
    user: Auth.UserPayload,
    draftId: string,
    dto: SaveModelDraftDto,
  ) {
    const draft = await this.assertDraftAccess(draftId, user);
    if (draft.status === 'SAVED') {
      throw new AppException({
        statusCode: 409,
        message:
          'Draft has already been saved as a Model — a draft can only be ' +
          'saved once.',
        type: 'ERROR',
      });
    }

    const runId = await this.resolveActiveRunId(draft);
    if (!runId) {
      throw new AppException({
        statusCode: 422,
        message:
          'This draft has no training run yet — start training before ' +
          'saving.',
        type: 'ERROR',
      });
    }
    const run = await this.prisma.modelTrainingRun.findUnique({
      where: { id: runId },
    });
    if (!run) {
      throw new AppException({
        statusCode: 422,
        message: `Run ${runId} no longer exists.`,
        type: 'ERROR',
      });
    }
    if (run.status !== 'SUCCEEDED') {
      throw new AppException({
        statusCode: 422,
        message:
          `The run backing this draft has status ${run.status}, not ` +
          'SUCCEEDED — nothing to save yet.',
        type: 'ERROR',
      });
    }
    if (!run.modelKey) {
      throw new AppException({
        statusCode: 422,
        message:
          'The run has no saved model artifact — cannot save. This should ' +
          'not happen for a SUCCEEDED run; check the run logs.',
        type: 'ERROR',
      });
    }
    // Bound to a new const, not reused as `run.modelKey` further down —
    // TS's narrowing on a property access (as opposed to a local binding)
    // is not guaranteed to survive the `await getRunManifest(...)` call
    // between this check and the transaction below.
    const modelObjectKey = run.modelKey;

    const existingName = await this.prisma.model.findFirst({
      where: {
        workspaceId: draft.workspaceId,
        name: { equals: dto.name, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existingName) {
      throw new AppException({
        statusCode: 400,
        message: 'A model with this name already exists in this location.',
        type: 'ERROR',
      });
    }

    // Same check createModelService makes on its own dto.nodeId — a node id
    // is meaningless (and a cross-tenant leak: getModels' own NODE_INCLUDE
    // resolves plan.name through it) unless it belongs to THIS workspace.
    // Covers both the request body's nodeId and the draft's own fallback —
    // PatchModelDraftSchema.nodeId is unvalidated z.string(), not .uuid(),
    // so a junk draft value must be caught here, not left to reach the FK
    // as an uncaught P2003.
    const nodeId = dto.nodeId ?? draft.nodeId ?? null;
    if (nodeId) {
      const node = await this.prisma.nodes.findFirst({
        where: { id: nodeId, workspaceId: draft.workspaceId },
      });
      if (!node) {
        throw new AppException({
          statusCode: 404,
          message: 'Node not found',
          type: 'ERROR',
        });
      }
    }

    // T11. Best-effort — a missing/unreadable manifest (every run trained
    // before the trainer image that added this field) must not fail the
    // save; framework_versions is simply absent from this Model's
    // provenance, same "honest legacy null" MODEL-FLOW-010-T06 established.
    // MODEL-SERVE-001-T01: model_sha256 read in the same call — it goes
    // onto ModelVersion.modelChecksum below, same honest-legacy-null policy.
    let frameworkVersions: Record<string, string> | null = null;
    let modelChecksum: string | null = null;
    if (run.manifestKey) {
      try {
        const manifest = await getRunManifest(run.manifestKey);
        frameworkVersions = manifest.framework_versions;
        modelChecksum = manifest.model_sha256 ?? null;
      } catch {
        frameworkVersions = null;
        modelChecksum = null;
      }
    }

    const ratio = this.extractSplitRatio(run.splitSpec);
    const trainTestSplit = ratio != null ? Math.round(ratio * 100) : undefined;
    // T12. `null` for every non-CV run, which is what makes this an additive
    // field rather than a behaviour change for the rows that already exist.
    const crossValidation = this.extractCvConfig(
      run.splitSpec,
      run.holdoutMetrics,
    );

    const config = ModelConfigSchema.parse({
      ...(dto.description !== undefined && { description: dto.description }),
      datasetId: run.datasetId,
      algorithm: run.algorithm,
      algorithms: [run.algorithm],
      targetVariables: [run.targetY],
      hyperparameters: this.extractHyperparameters(run.hyperparameters),
      ...(trainTestSplit !== undefined && { trainTestSplit }),
      ...(dto.deployment !== undefined && { deployment: dto.deployment }),
      // T11. Nested inside `config`, not a sibling of it — `normalizeData`
      // (model.authorized.service.ts) whitelists top-level `Model.data` keys
      // explicitly, and `frameworkVersions` is not one of them; `config` is,
      // so this is what makes it survive the very next `updateModel` call
      // (e.g. Save & Deploy's immediate `deployStatus: 'running'` write).
      frameworkVersions,
      // T12. Same nesting rationale as `frameworkVersions` directly above —
      // and `trainTestSplit` is correctly absent whenever this is non-null:
      // a `cv_expanding` splitSpec carries no `ratio` for extractSplitRatio
      // to find, because a CV run genuinely has no single train/test cut.
      crossValidation,
    });

    const initData = {
      deployStatus: 'stopped' as const,
      prodStatus: 'normal' as const,
      logs: [] as unknown[],
      config,
    };

    try {
      const model = await this.prisma.$transaction(async (tx) => {
        const created = await tx.model.create({
          data: {
            workspaceId: draft.workspaceId,
            name: dto.name,
            nodesId: nodeId,
            datasetId: run.datasetId,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            data: JSON.parse(JSON.stringify(initData)),
          },
          include: NODE_INCLUDE,
        });
        await tx.modelTrainingRun.update({
          where: { id: run.id },
          data: { modelId: created.id },
        });
        await tx.modelDraft.update({
          where: { id: draftId },
          data: { status: 'SAVED', savedModelId: created.id },
        });

        // MODEL-SERVE-001-T03. Save Model creates version 1 in STAGING,
        // never PRODUCTION — saving is not deploying (CLAUDE.md §8/§13). In
        // the SAME transaction as the Model create: a Model with no version
        // row is a state nothing downstream (promote/rollback/serving) can
        // interpret. `version: 1` is hardcoded, not max()+1 — `created` is a
        // brand-new Model in this same transaction, so no other version can
        // exist yet; a retrain (MODEL-SERVE-004) creating a later version
        // needs the max()+1 allocation DS-LAKE-009-T03 uses, this path does
        // not. Every field below is copied from the adopted run's own
        // pinned columns (goldArtifactId/goldObjectKey/artifactChecksum/
        // featureSpecKey), one hop, never re-derived through the dataset's
        // CURRENT artifact (MODEL-SERVE-000-T03/T07's findings) — resolved
        // per decisions.open_question_pin_by_pointer_or_copy_bytes as a
        // POINTER, matching MODEL-FLOW-007-T10's own adopt-by-pointer rule:
        // this row references the run's bytes, it never copies them.
        await tx.modelVersion.create({
          data: {
            modelId: created.id,
            version: 1,
            sourceRunId: run.id,
            sourceDatasetId: run.datasetId,
            goldArtifactId: run.goldArtifactId,
            goldObjectKey: run.goldObjectKey,
            artifactChecksum: run.artifactChecksum,
            featureSpecKey: run.featureSpecKey,
            modelObjectKey,
            modelChecksum,
            algorithm: run.algorithm,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            hyperparameters: JSON.parse(JSON.stringify(run.hyperparameters)),
            imageDigest: run.imageDigest,
            ...(frameworkVersions !== null && {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              frameworkVersions: JSON.parse(JSON.stringify(frameworkVersions)),
            }),
            ...(run.metrics != null && {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              metrics: JSON.parse(JSON.stringify(run.metrics)),
            }),
          },
        });

        return created;
      });

      return {
        statusCode: 201,
        message: 'Model saved successfully',
        type: 'SUCCESS' as const,
        data: model,
      };
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new AppException({
          statusCode: 409,
          message: 'A model with this name already exists in this location.',
          type: 'ERROR',
        });
      }
      throw err;
    }
  }

  private mapDraft(draft: {
    id: string;
    name: string | null;
    workspaceId: string;
    plantId: string | null;
    nodeId: string | null;
    datasetId: string | null;
    targetY: string | null;
    algorithm: string | null;
    hyperparameters: unknown;
    splitRatio: number | null;
    status: string;
    currentRunId: string | null;
    savedModelId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: draft.id,
      name: draft.name,
      workspaceId: draft.workspaceId,
      plantId: draft.plantId,
      nodeId: draft.nodeId,
      datasetId: draft.datasetId,
      targetY: draft.targetY,
      algorithm: draft.algorithm,
      hyperparameters: draft.hyperparameters,
      splitRatio: draft.splitRatio,
      status: draft.status,
      currentRunId: draft.currentRunId,
      savedModelId: draft.savedModelId,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }
}
