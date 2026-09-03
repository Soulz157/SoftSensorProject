-- MODEL-SERVE-003. Hand-written, not `prisma migrate dev`-generated — same
-- reason as migrations/20260901090000_model_serve_001_model_version: a
-- pre-existing, unrelated drift in this dev DB makes `migrate dev` refuse
-- without a full reset. Applied via `prisma migrate deploy`, which does not
-- diff against a shadow database the way `migrate dev` does.

-- ── 1. New enum ──────────────────────────────────────────────────────────
CREATE TYPE "PredictionJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- ── 2. New table ─────────────────────────────────────────────────────────
CREATE TABLE "PredictionJob" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "inputKey" TEXT NOT NULL,
    "outputKey" TEXT,
    "outputChecksum" TEXT,
    "rowCount" INTEGER,
    "idempotencyKey" TEXT,
    "status" "PredictionJobStatus" NOT NULL DEFAULT 'QUEUED',
    "failureReason" TEXT,
    "imageDigest" TEXT NOT NULL,
    "containerId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PredictionJob_pkey" PRIMARY KEY ("id")
);

-- ── 3. Indexes ───────────────────────────────────────────────────────────
CREATE INDEX "PredictionJob_modelId_createdAt_idx" ON "PredictionJob"("modelId", "createdAt");
CREATE INDEX "PredictionJob_status_idx" ON "PredictionJob"("status");

-- MODEL-SERVE-003-T02. Same hand-added-partial-index precedent as
-- ModelVersion_one_production_per_model and ModelCandidateJob_one_live_per_draft:
-- Prisma's schema DSL cannot express a partial unique index. Scoped
-- (modelId, idempotencyKey), not idempotencyKey alone, so two different
-- callers' keys cannot collide across models. NULL idempotencyKey rows are
-- excluded (Postgres never treats NULL = NULL for uniqueness, but the WHERE
-- clause makes that explicit rather than incidental) — a job submitted
-- without a key is not deduplicated at all, which is the correct behaviour:
-- idempotency is opt-in per the caller's own request.
CREATE UNIQUE INDEX "PredictionJob_idempotency_key"
  ON "PredictionJob"("modelId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

-- ── 4. Foreign keys ──────────────────────────────────────────────────────
ALTER TABLE "PredictionJob" ADD CONSTRAINT "PredictionJob_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- NO ACTION, not RESTRICT — same reasoning as ModelVersion_sourceRunId_fkey:
-- deleting a Model cascades onto ModelVersion (modelId) AND PredictionJob
-- (modelId, via the constraint above) in the same statement. RESTRICT is
-- checked immediately per row and would fire while ModelVersion's own
-- cascade is still being processed, before the referencing PredictionJob
-- row is gone, making a Model delete fail on any model with a prediction
-- job. NO ACTION defers the check to end-of-statement, by which point
-- PredictionJob's own cascade (via modelId) has already removed the row.
ALTER TABLE "PredictionJob" ADD CONSTRAINT "PredictionJob_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "PredictionJob" ADD CONSTRAINT "PredictionJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
