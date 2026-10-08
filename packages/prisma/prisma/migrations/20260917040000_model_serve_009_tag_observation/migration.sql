-- MODEL-SERVE-009-T02. Per-tag current state: one row per (model, tag),
-- updated in place, never one row per fetch.
--
-- APPLIED BY HAND, NOT BY `prisma migrate dev`, for the reason recorded in
-- MODEL-SERVE-010-T03: this database carries pre-existing migration-history
-- drift (20260825030923_model_flow_005_fine_tuning_job was edited after it
-- had been applied), so `migrate dev` distrusts the history and offers only
-- `migrate reset` — which drops a database holding 391 real training runs.
-- Generated with `prisma migrate diff --from-config-datasource --to-schema`,
-- whose output was exactly and only the CREATE TABLE below.
--
-- Purely additive: a new table with no change to any existing one.
-- CreateTable
CREATE TABLE "TagObservation" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "lastValue" DOUBLE PRECISION,
    "lastStatus" INTEGER,
    "lastSeenAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3),
    "lastFetchOutcome" TEXT,
    "lastWindowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TagObservation_modelId_idx" ON "TagObservation"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "TagObservation_modelId_tag_key" ON "TagObservation"("modelId", "tag");

-- AddForeignKey
ALTER TABLE "TagObservation" ADD CONSTRAINT "TagObservation_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

