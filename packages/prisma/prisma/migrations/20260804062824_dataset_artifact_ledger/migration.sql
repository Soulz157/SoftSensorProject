-- CreateEnum
CREATE TYPE "DatasetArtifactType" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'FINAL');

-- CreateEnum
CREATE TYPE "DatasetStatus" AS ENUM ('DRAFT', 'VALIDATED', 'ACTIVE', 'DEPRECATED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Dataset" ADD COLUMN     "currentArtifactId" TEXT;

-- CreateTable
CREATE TABLE "DatasetArtifact" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "parentArtifactId" TEXT,
    "type" "DatasetArtifactType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'parquet',
    "checksum" TEXT NOT NULL DEFAULT '',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "columnCount" INTEGER NOT NULL DEFAULT 0,
    "featureCount" INTEGER NOT NULL DEFAULT 0,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "missingPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "operations" JSONB NOT NULL,
    "columnStats" JSONB,
    "featureSpecKey" TEXT,
    "validationKey" TEXT,
    "durationMs" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DatasetArtifact_datasetId_idx" ON "DatasetArtifact"("datasetId");

-- CreateIndex
CREATE INDEX "DatasetArtifact_runId_idx" ON "DatasetArtifact"("runId");

-- CreateIndex
CREATE INDEX "DatasetArtifact_parentArtifactId_idx" ON "DatasetArtifact"("parentArtifactId");

-- CreateIndex
CREATE INDEX "DatasetArtifact_datasetId_type_idx" ON "DatasetArtifact"("datasetId", "type");

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DatasetVersion"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_currentArtifactId_fkey" FOREIGN KEY ("currentArtifactId") REFERENCES "DatasetArtifact"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DatasetArtifact" ADD CONSTRAINT "DatasetArtifact_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetArtifact" ADD CONSTRAINT "DatasetArtifact_parentArtifactId_fkey" FOREIGN KEY ("parentArtifactId") REFERENCES "DatasetArtifact"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DatasetArtifact" ADD CONSTRAINT "DatasetArtifact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill (DS-LAKE-002-T04). Hand-written; Prisma does not generate data moves.
--
-- Every existing DatasetVersion is a stage artifact wearing the wrong hat, so it
-- is copied forward into the artifact ledger. DatasetVersion itself is left
-- untouched here: DS-LAKE-009 reshapes it into a registry row once the live
-- writers at dataset-version.authorized.service.ts:187 and
-- preprocessing-job.service.ts:290 have been repointed.
--
-- The artifact REUSES the version's UUID as its own id. That makes the parent
-- mapping a straight copy of parentVersionId, and keeps the backfill auditable
-- afterwards: a legacy artifact and the version it came from share an id.
-- Different tables, so there is no collision.
--
-- Parents are set in a SECOND statement. Foreign keys are checked per row on
-- INSERT, so a child appearing before its parent inside one INSERT..SELECT
-- would fail on the self-referencing constraint.
-- ---------------------------------------------------------------------------

INSERT INTO "DatasetArtifact" (
    "id", "datasetId", "runId", "parentArtifactId", "type",
    "objectKey", "format", "checksum", "schemaVersion",
    "columnCount", "featureCount", "rowCount", "missingPct", "sizeBytes",
    "operations", "columnStats", "durationMs", "createdById", "createdAt"
)
SELECT
    v."id",
    v."datasetId",
    'backfill-' || v."datasetId",
    NULL,
    -- No ELSE: an unmapped stage makes type NULL and violates NOT NULL, which
    -- fails the migration loudly instead of silently mislabelling an artifact.
    (CASE v."stage"
        WHEN 'RAW'     THEN 'BRONZE'
        WHEN 'CLEAN'   THEN 'SILVER'
        WHEN 'FEATURE' THEN 'GOLD'
     END)::"DatasetArtifactType",
    v."objectKey",
    v."format",
    -- These artifacts predate checksums. Empty means "not yet computed", and
    -- DS-LAKE-003 recomputes it on first read rather than inventing one here.
    '',
    1,
    v."columnCount",
    0,
    v."rowCount",
    v."missingPct",
    v."sizeBytes"::BIGINT,
    v."operations",
    v."columnStats",
    v."durationMs",
    v."createdById",
    v."createdAt"
FROM "DatasetVersion" v;

UPDATE "DatasetArtifact" a
SET "parentArtifactId" = v."parentVersionId"
FROM "DatasetVersion" v
WHERE a."id" = v."id" AND v."parentVersionId" IS NOT NULL;

-- The hydration pointer follows, and can be a straight copy for the same reason
-- the parent mapping could: backfilled artifact ids equal their version ids.
UPDATE "Dataset" d
SET "currentArtifactId" = d."currentVersionId"
WHERE d."currentVersionId" IS NOT NULL;
