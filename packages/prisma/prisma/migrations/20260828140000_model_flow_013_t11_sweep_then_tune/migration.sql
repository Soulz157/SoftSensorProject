-- MODEL-FLOW-013-T11. Adds SWEEP_THEN_TUNE: a job whose phase 1 is an
-- algorithm sweep ("Find Best Model") and whose phase 2 (appended to the
-- SAME `candidates` array by `advanceJobForRun`, never a second job — the
-- (modelDraftId)-scoped partial unique index forbids two live jobs on one
-- draft) tunes phase 1's winning algorithm via the curated shortlist in
-- apps/backend/src/lib/tuning-grid.ts.
--
-- Hand-written, not `prisma migrate dev`-generated, for the same reason
-- 20260827120000_model_flow_013_candidate_job was: `prisma migrate dev`
-- demands a full `migrate reset` here because of pre-existing, unrelated
-- DatasetArtifact.droppedBadRows drift in the dev DB with no migration
-- file. Applied via `prisma db execute --file`. A single ADD VALUE needs no
-- data backfill — existing rows keep their current `kind`.

ALTER TYPE "ModelCandidateJobKind" ADD VALUE 'SWEEP_THEN_TUNE';
