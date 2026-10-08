-- MODEL-SERVE-001. Hand-written, not `prisma migrate dev`-generated — same
-- reason as migrations/20260827120000_model_flow_013_candidate_job: a
-- pre-existing, unrelated drift in this dev DB (DatasetArtifact.
-- droppedBadRows exists in the DB with no migration file) makes
-- `migrate dev` refuse without a full reset. Not caused by and not fixed in
-- this pass. Applied via `prisma migrate deploy`, which does not diff
-- against a shadow database the way `migrate dev` does.

-- ── 1. New enum ──────────────────────────────────────────────────────────
CREATE TYPE "ModelVersionStage" AS ENUM ('STAGING', 'PRODUCTION', 'ARCHIVED');

-- ── 2. New table ─────────────────────────────────────────────────────────
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "stage" "ModelVersionStage" NOT NULL DEFAULT 'STAGING',
    "sourceRunId" TEXT NOT NULL,
    "sourceDatasetId" TEXT NOT NULL,
    "goldArtifactId" TEXT NOT NULL,
    "goldObjectKey" TEXT NOT NULL,
    "artifactChecksum" TEXT NOT NULL,
    "featureSpecKey" TEXT,
    "modelObjectKey" TEXT NOT NULL,
    "modelChecksum" TEXT,
    "algorithm" TEXT NOT NULL,
    "hyperparameters" JSONB NOT NULL,
    "frameworkVersions" JSONB,
    "imageDigest" TEXT NOT NULL,
    "metrics" JSONB,
    "promotionOverride" JSONB,
    "promotedById" TEXT,
    "promotedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- ── 3. Uniques + indexes ─────────────────────────────────────────────────
CREATE UNIQUE INDEX "ModelVersion_sourceRunId_key" ON "ModelVersion"("sourceRunId");
CREATE UNIQUE INDEX "ModelVersion_modelId_version_key" ON "ModelVersion"("modelId", "version");
CREATE INDEX "ModelVersion_modelId_stage_idx" ON "ModelVersion"("modelId", "stage");
CREATE INDEX "ModelVersion_modelId_archivedAt_idx" ON "ModelVersion"("modelId", "archivedAt");

-- MODEL-SERVE-001-T02. Same hand-added-partial-index precedent as
-- migrations/20260818021900_model_flow_002_owner_check and
-- .../20260825030923_model_flow_005_fine_tuning_job's own
-- ModelFineTuningJob_one_live_per_draft: Prisma's schema DSL cannot express
-- a partial unique index. At most one PRODUCTION version may exist per
-- model, enforced at the database — two concurrent promotes racing past an
-- application-level check would otherwise both succeed.
CREATE UNIQUE INDEX "ModelVersion_one_production_per_model"
  ON "ModelVersion"("modelId")
  WHERE "stage" = 'PRODUCTION';

-- ── 4. Foreign keys ──────────────────────────────────────────────────────
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- NO ACTION, not RESTRICT: deleting a Model cascades onto BOTH
-- ModelTrainingRun (modelId) and ModelVersion (modelId) in the same
-- statement. RESTRICT is checked immediately per row and would fire while
-- the run's own cascade is being processed, before the referencing
-- ModelVersion row is gone, making deleteModelService fail on any model
-- with a saved version. NO ACTION defers the check to end-of-statement, by
-- which point ModelVersion's own cascade has already removed the row, so
-- the check passes. It still blocks a hypothetical direct delete of a
-- ModelTrainingRun that a ModelVersion references outside of a Model
-- delete (no such endpoint exists today, but the protection is free).
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "ModelTrainingRun"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_promotedById_fkey" FOREIGN KEY ("promotedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
