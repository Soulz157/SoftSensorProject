-- MODEL-SERVE-005. Hand-written, not `prisma migrate dev`-generated — same
-- reason as every prior migration in this ledger's own run
-- (20260901090000, 20260902160000, 20260903090000): a pre-existing,
-- unrelated drift in this dev DB makes `migrate dev` refuse without a full
-- reset. Applied via `prisma migrate deploy`, which does not diff against a
-- shadow database the way `migrate dev` does.
--
-- What this does: the queryable index row for a sampled synchronous
-- /predict request. The actual sampled data (raw + model-ready feature
-- values, predictions) is a Parquet object in MinIO under
-- serving-logs/{modelId}/{modelVersionId}/dt=.../hour=.../{uuid}.parquet —
-- this table never holds that payload, only the pointer plus the
-- sufficient-statistics aggregates a drift computation needs.

-- ── 1. New table ─────────────────────────────────────────────────────────
CREATE TABLE "PredictionLog" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "objectKey" TEXT,
    "objectChecksum" TEXT,
    "rowCount" INTEGER NOT NULL,
    "loggedRows" INTEGER NOT NULL,
    "samplingRate" DOUBLE PRECISION NOT NULL,
    "featureStats" JSONB NOT NULL,
    "predictionStats" JSONB NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionLog_pkey" PRIMARY KEY ("id")
);

-- ── 2. Indexes ───────────────────────────────────────────────────────────
CREATE INDEX "PredictionLog_modelId_requestedAt_idx" ON "PredictionLog"("modelId", "requestedAt");
CREATE INDEX "PredictionLog_modelVersionId_requestedAt_idx" ON "PredictionLog"("modelVersionId", "requestedAt");

-- ── 3. Foreign keys ──────────────────────────────────────────────────────
ALTER TABLE "PredictionLog" ADD CONSTRAINT "PredictionLog_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- NO ACTION, not RESTRICT — the identical footgun and identical fix
-- PredictionJob_modelVersionId_fkey already documents: deleting a Model
-- cascades onto ModelVersion (modelId) AND PredictionLog (modelId, via the
-- constraint above) in the same statement. RESTRICT is checked immediately
-- per row and would fire while ModelVersion's own cascade is still being
-- processed, before the referencing PredictionLog row is gone, making a
-- Model delete fail on any model with a logged prediction. NO ACTION
-- defers the check to end-of-statement, by which point PredictionLog's own
-- cascade (via modelId) has already removed the row.
ALTER TABLE "PredictionLog" ADD CONSTRAINT "PredictionLog_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
