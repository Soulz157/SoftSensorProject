-- MODEL-SERVE-006-T01. Hand-written, not `prisma migrate dev`-generated —
-- same reason as every migration since 20260901090000_model_serve_001_model_
-- version: a pre-existing, unrelated drift in this dev DB makes `migrate dev`
-- refuse without a full reset. Applied via `prisma migrate deploy`, which
-- does not diff against a shadow database the way `migrate dev` does.

-- ── 1. New enum ──────────────────────────────────────────────────────────
CREATE TYPE "InferenceWindowStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- ── 2. New tables ────────────────────────────────────────────────────────
CREATE TABLE "InferenceWindow" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "status" "InferenceWindowStatus" NOT NULL DEFAULT 'PENDING',
    "inputKey" TEXT,
    "inputChecksum" TEXT,
    "predictionsKey" TEXT,
    "metricsKey" TEXT,
    "inputRows" INTEGER,
    "missingPct" DOUBLE PRECISION,
    "imageDigest" TEXT,
    "containerId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InferenceWindow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InferenceWindowLog" (
    "id" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InferenceWindowLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InferenceSchedule" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cadenceMinutes" INTEGER NOT NULL DEFAULT 60,
    "lagMinutes" INTEGER NOT NULL DEFAULT 15,
    "sourceId" TEXT NOT NULL,
    "fetchConfig" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InferenceSchedule_pkey" PRIMARY KEY ("id")
);

-- ── 3. Indexes ───────────────────────────────────────────────────────────
-- THE unique constraint the whole design rests on: idempotency (a repeated
-- insert for the same window is a no-op under createMany/skipDuplicates),
-- gap detection (status != 'SUCCEEDED' is a plain scan), and backfill (an
-- over-requested range is harmless).
CREATE UNIQUE INDEX "InferenceWindow_modelVersionId_windowStart_key" ON "InferenceWindow"("modelVersionId", "windowStart");
CREATE INDEX "InferenceWindow_modelId_windowStart_idx" ON "InferenceWindow"("modelId", "windowStart");
CREATE INDEX "InferenceWindow_status_idx" ON "InferenceWindow"("status");

CREATE INDEX "InferenceWindowLog_windowId_createdAt_idx" ON "InferenceWindowLog"("windowId", "createdAt");

-- One schedule per model — the version is pinned per WINDOW at creation
-- from whatever is PRODUCTION then, not by a schedule-to-version link.
CREATE UNIQUE INDEX "InferenceSchedule_modelId_key" ON "InferenceSchedule"("modelId");
CREATE INDEX "InferenceSchedule_enabled_idx" ON "InferenceSchedule"("enabled");

-- ── 4. Foreign keys ──────────────────────────────────────────────────────
ALTER TABLE "InferenceWindow" ADD CONSTRAINT "InferenceWindow_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- NO ACTION, not RESTRICT — same reasoning as PredictionJob_modelVersionId_
-- fkey and PredictionLog's own copy of it: deleting a Model cascades onto
-- ModelVersion (modelId) AND InferenceWindow (modelId, via the constraint
-- above) in the same statement. RESTRICT is checked immediately per row and
-- would fire while ModelVersion's own cascade is still being processed,
-- before the referencing InferenceWindow row is gone, making a Model delete
-- fail on any model with a scheduled window. NO ACTION defers the check to
-- end-of-statement, by which point InferenceWindow's own cascade (via
-- modelId) has already removed the row.
ALTER TABLE "InferenceWindow" ADD CONSTRAINT "InferenceWindow_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "InferenceWindowLog" ADD CONSTRAINT "InferenceWindowLog_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "InferenceWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InferenceSchedule" ADD CONSTRAINT "InferenceSchedule_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InferenceSchedule" ADD CONSTRAINT "InferenceSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
