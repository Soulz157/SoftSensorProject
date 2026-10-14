-- MODEL-SERVE-032. PI write-back with before/after history -- purely additive.
--
-- Three new tables and two enums; no existing table or column is touched, so
-- nothing changes behaviour until the Evaluation page first writes.
-- Applied by hand (never `migrate dev` here: drift makes it offer a reset).

-- CreateEnum
CREATE TYPE "PiWriteKind" AS ENUM ('PREDICTION', 'LAB', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "PiWriteStatus" AS ENUM ('PENDING', 'WRITING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'ROLLED_BACK');

-- CreateTable
CREATE TABLE "ModelWriteBackConfig" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "predictionTag" TEXT,
    "labTag" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelWriteBackConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiWriteBatch" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" "PiWriteKind" NOT NULL,
    "tag" TEXT NOT NULL,
    "rangeFrom" TIMESTAMP(3) NOT NULL,
    "rangeTo" TIMESTAMP(3) NOT NULL,
    "pointCount" INTEGER NOT NULL,
    "status" "PiWriteStatus" NOT NULL DEFAULT 'PENDING',
    "modelVersionId" TEXT,
    "rollbackOfId" TEXT,
    "createdById" TEXT,
    "piAccount" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PiWriteBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiWriteValue" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "beforeExisted" BOOLEAN NOT NULL,
    "beforeValue" DOUBLE PRECISION,
    "sentValue" DOUBLE PRECISION NOT NULL,
    "afterValue" DOUBLE PRECISION,
    "itemOk" BOOLEAN NOT NULL DEFAULT false,
    "itemError" TEXT,

    CONSTRAINT "PiWriteValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModelWriteBackConfig_modelId_key" ON "ModelWriteBackConfig"("modelId");

-- CreateIndex
CREATE INDEX "PiWriteBatch_modelId_createdAt_idx" ON "PiWriteBatch"("modelId", "createdAt");

-- CreateIndex
CREATE INDEX "PiWriteBatch_sourceId_tag_status_idx" ON "PiWriteBatch"("sourceId", "tag", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PiWriteValue_batchId_timestamp_key" ON "PiWriteValue"("batchId", "timestamp");

-- AddForeignKey
ALTER TABLE "ModelWriteBackConfig" ADD CONSTRAINT "ModelWriteBackConfig_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelWriteBackConfig" ADD CONSTRAINT "ModelWriteBackConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiWriteBatch" ADD CONSTRAINT "PiWriteBatch_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiWriteBatch" ADD CONSTRAINT "PiWriteBatch_rollbackOfId_fkey" FOREIGN KEY ("rollbackOfId") REFERENCES "PiWriteBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiWriteBatch" ADD CONSTRAINT "PiWriteBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiWriteValue" ADD CONSTRAINT "PiWriteValue_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PiWriteBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most ONE open write per (source, tag): the atomic claim that serialises
-- two OWNERs writing the same tag at once. A partial index, so finished
-- batches (any number) never conflict. Prisma cannot express this; the
-- service treats the unique violation (P2002) as "another write in flight".
CREATE UNIQUE INDEX "PiWriteBatch_one_open_per_tag" ON "PiWriteBatch"("sourceId", "tag") WHERE "status" IN ('PENDING', 'WRITING');
