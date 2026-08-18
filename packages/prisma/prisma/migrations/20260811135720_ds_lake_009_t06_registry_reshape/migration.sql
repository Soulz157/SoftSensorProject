-- DropForeignKey
ALTER TABLE "DatasetVersion" DROP CONSTRAINT "DatasetVersion_parentVersionId_fkey";

-- DropIndex
DROP INDEX "DatasetVersion_parentVersionId_idx";

-- AlterTable
ALTER TABLE "DatasetVersion" DROP COLUMN "columnStats",
DROP COLUMN "format",
DROP COLUMN "objectKey",
DROP COLUMN "operations",
DROP COLUMN "parentVersionId",
DROP COLUMN "stage",
ADD COLUMN     "artifactId" TEXT,
ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "featureCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lineage" JSONB,
ADD COLUMN     "qualityScore" DOUBLE PRECISION,
ADD COLUMN     "schemaVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "semanticVersion" TEXT,
ADD COLUMN     "status" "DatasetStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "sizeBytes" SET DATA TYPE BIGINT;

-- CreateIndex
CREATE INDEX "DatasetVersion_artifactId_idx" ON "DatasetVersion"("artifactId");

-- AddForeignKey
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "DatasetArtifact"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Backfill (DS-LAKE-009-T07). Hand-written; Prisma does not generate data
-- moves. Every existing DatasetVersion row was itself backfilled forward
-- into DatasetArtifact by DS-LAKE-002-T04, REUSING the version's own uuid as
-- the artifact's id (see that migration's own comment) -- which is exactly
-- what makes the pointer below a trivial, always-correct copy rather than a
-- guess: a DatasetArtifact with this row's own id is guaranteed to exist.
-- ---------------------------------------------------------------------------

UPDATE "DatasetVersion" v
SET "artifactId" = v."id",
    "checksum" = a."checksum"
FROM "DatasetArtifact" a
WHERE a."id" = v."id" AND v."artifactId" IS NULL;

-- A legacy version still referenced by Dataset.currentVersionId is the LIVE
-- version of a real saved dataset today, not a draft -- the DRAFT default
-- above would misrepresent it. Every other legacy row (superseded/orphaned)
-- keeps the DRAFT default, which is the honest "no longer knowable" answer.
UPDATE "DatasetVersion" v
SET "status" = 'ACTIVE'
FROM "Dataset" d
WHERE d."currentVersionId" = v."id";
