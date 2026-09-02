import { BadRequestException } from '@nestjs/common';
import { draftRunKey, modelRunKey } from './artifact-keys';

/**
 * Extracted from `model-run.authorized.service.ts` (MODEL-FLOW-016-T07) —
 * pure, ownership-only helpers with no Prisma/HTTP dependency, needed by
 * BOTH the training-run service and the new scoring service
 * (`model-run-score.authorized.service.ts`). Two callers is the line for a
 * lib extraction per CLAUDE.md's "do not duplicate business logic" rule;
 * one caller (the original state) did not warrant it.
 */
export type RunOwner =
  | { scope: 'model'; id: string }
  | { scope: 'draft'; id: string };

/**
 * EXACTLY ONE of modelId / modelDraftId is set, enforced by a DB CHECK
 * constraint (MODEL-FLOW-002) — a run created from the wizard has
 * modelDraftId until Save Model adopts it (MODEL-FLOW-003-T08), after which
 * modelId is set and modelDraftId is KEPT for traceability. This resolves
 * which root (models/ or drafts/) the run's own outputs live under, since a
 * run adopted at Save Model still keeps writing to its original prefix —
 * Save Model never re-uploads bytes.
 */
export function resolveRunOwner(run: {
  id: string;
  modelId: string | null;
  modelDraftId: string | null;
}): RunOwner {
  if (run.modelId) return { scope: 'model', id: run.modelId };
  if (run.modelDraftId) return { scope: 'draft', id: run.modelDraftId };
  // Unreachable given the CHECK constraint — guarded so a future schema
  // change cannot silently reintroduce a run with neither.
  throw new BadRequestException(
    `Run ${run.id} has neither modelId nor modelDraftId.`,
  );
}

/** Same key layout `complete()` writes run outputs to — every reader of a
 * run's own prefix (claim's holdout replay, scoring's model/holdout reads,
 * complete's uploaded-filename resolution) needs the identical layout. */
export function buildRunKey(
  owner: RunOwner,
  runId: string,
  filename: string,
): string {
  return owner.scope === 'draft'
    ? draftRunKey(owner.id, runId, filename)
    : modelRunKey(owner.id, runId, filename);
}
