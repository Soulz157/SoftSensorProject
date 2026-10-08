/**
 * MODEL-SERVE-001-T02/T04. The `ModelVersion` lifecycle predicate — same
 * shape and same division of labour as `dataset-version-transitions.ts`
 * (pure, no Prisma, no I/O; the caller owns fetching current state and
 * writing the new one).
 *
 * This graph is NOT the dataset side's strict forward line. Per this
 * feature's own decision (MODEL-SERVE-001-T04's own detail: "Rollback is
 * promote pointed at the previous PRODUCTION — not a distinct mechanism, so
 * it cannot rot separately"), ARCHIVED -> PRODUCTION is a LEGAL edge:
 *
 *   STAGING  -> PRODUCTION   (a normal promote)
 *   ARCHIVED -> PRODUCTION   (a rollback, which IS a promote)
 *   PRODUCTION -> ARCHIVED   (the automatic demotion of the version being
 *                             replaced — a SIDE EFFECT the promote service
 *                             applies to a DIFFERENT row, never something a
 *                             caller requests directly on the version they
 *                             are demoting)
 *
 * `isPromotable` therefore answers one question only — "can THIS version,
 * in its current stage, become the new PRODUCTION" — not the general
 * from/to graph question `isLegalTransition` answers on the dataset side.
 * A version that is ALREADY `PRODUCTION` is not promotable; the service
 * layer treats promoting an already-live version as an idempotent no-op
 * (same policy split `isLegalTransition`'s own doc comment describes for
 * same-state dataset transitions), never as this predicate returning true.
 *
 * The single-PRODUCTION-per-model invariant is enforced by the database
 * (`ModelVersion_one_production_per_model`, a partial unique index — see
 * the migration), not by this module: whether ANOTHER version already
 * holds PRODUCTION is a cross-row fact this pure predicate cannot and
 * should not know.
 */

export type ModelVersionStage = 'STAGING' | 'PRODUCTION' | 'ARCHIVED';

const PROMOTABLE_FROM: ReadonlySet<ModelVersionStage> = new Set([
  'STAGING',
  'ARCHIVED',
]);

/** True for STAGING and ARCHIVED (a rollback source); false for PRODUCTION
 *  (already live — promoting it again is the service's idempotency case,
 *  not an illegal transition this predicate rejects). */
export function isPromotable(from: ModelVersionStage): boolean {
  return PROMOTABLE_FROM.has(from);
}
