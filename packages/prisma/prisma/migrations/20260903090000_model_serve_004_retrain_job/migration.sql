-- MODEL-SERVE-004. Hand-written, not `prisma migrate dev`-generated — same
-- reason as migrations/20260901090000_model_serve_001_model_version and
-- 20260902160000_model_serve_003_prediction_job: a pre-existing, unrelated
-- drift in this dev DB makes `migrate dev` refuse without a full reset.
-- Applied via `prisma migrate deploy`, which does not diff against a shadow
-- database the way `migrate dev` does.
--
-- What this does: makes ModelCandidateJob draft- OR model-owned, so a retrain
-- reuses the EXACT chaining machinery (advanceJobForRun's compare-and-swap)
-- MODEL-FLOW-005/013 already built and live-verified, rather than a second
-- orchestrator that can drift from the first.

-- ── 1. Owner columns ─────────────────────────────────────────────────────
ALTER TABLE "ModelCandidateJob" ALTER COLUMN "modelDraftId" DROP NOT NULL;
ALTER TABLE "ModelCandidateJob" ADD COLUMN "modelId" TEXT;

-- Retrain-only columns; NULL on every draft-owned job (including every row
-- that already exists), which is why no backfill is needed.
ALTER TABLE "ModelCandidateJob" ADD COLUMN "sourceVersionId" TEXT;
ALTER TABLE "ModelCandidateJob" ADD COLUMN "resultVersionId" TEXT;
ALTER TABLE "ModelCandidateJob" ADD COLUMN "idempotencyKey" TEXT;

-- ── 2. Owner FK ──────────────────────────────────────────────────────────
-- CASCADE, matching ModelTrainingRun_modelId_fkey and PredictionJob_modelId_
-- fkey: a deleted Model's retrain jobs are meaningless. sourceVersionId and
-- resultVersionId deliberately get NO foreign key at all — see their schema
-- comments: an FK there adds a third edge to the Model -> ModelVersion /
-- ModelTrainingRun cascade diamond that already broke deleteModelService once
-- (ModelVersion_sourceRunId_fkey, migration 20260901090000).
ALTER TABLE "ModelCandidateJob" ADD CONSTRAINT "ModelCandidateJob_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. Owner CHECK ───────────────────────────────────────────────────────
-- XOR, not the "at least one" shape ModelTrainingRun_owner_present uses: a
-- run is ADOPTED from a draft to a Model by Save Model (both set, deliberately
-- — schema.prisma's own comment), but a job is never adopted, so "both" here
-- would be a row nothing can interpret.
ALTER TABLE "ModelCandidateJob" ADD CONSTRAINT "ModelCandidateJob_owner_exactly_one"
  CHECK (("modelDraftId" IS NULL) <> ("modelId" IS NULL));

-- ── 4. Indexes ───────────────────────────────────────────────────────────
CREATE INDEX "ModelCandidateJob_modelId_idx" ON "ModelCandidateJob"("modelId");

-- MODEL-SERVE-004-T02, and the guarantee behind V02 ("three concurrent
-- triggers produce ONE container"). Exact analogue of
-- ModelCandidateJob_one_live_per_draft, which the same table already carries
-- for the wizard — Prisma's DSL cannot express a partial index, so both are
-- hand-written. This is what makes the lock a DATABASE fact rather than a
-- read-then-write check: the losing request never reaches the spawn, because
-- it never gets a job row. The `modelId IS NOT NULL` clause keeps every
-- draft-owned job (modelId NULL) out of this index entirely.
CREATE UNIQUE INDEX "ModelCandidateJob_one_live_per_model"
  ON "ModelCandidateJob"("modelId")
  WHERE "modelId" IS NOT NULL AND "status" IN ('QUEUED', 'RUNNING');

-- Same shape and same opt-in semantics as PredictionJob_idempotency_key: a
-- trigger sent without a key is not deduplicated across time at all (the live
-- lock above still applies while a job is running). Scoped (modelId,
-- idempotencyKey) so two models' keys cannot collide.
CREATE UNIQUE INDEX "ModelCandidateJob_idempotency_key"
  ON "ModelCandidateJob"("modelId", "idempotencyKey")
  WHERE "modelId" IS NOT NULL AND "idempotencyKey" IS NOT NULL;
