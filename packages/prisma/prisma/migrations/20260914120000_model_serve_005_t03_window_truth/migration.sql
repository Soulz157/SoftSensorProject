-- MODEL-SERVE-005-T03. Hand-written, not `prisma migrate dev`-generated —
-- same reason as every migration since 20260901090000_model_serve_001_model_
-- version: a pre-existing, unrelated drift in this dev DB makes `migrate dev`
-- refuse without a full reset. Applied via `prisma migrate deploy`.

-- ── 1. The ground-truth half of the schedule's lag trade ─────────────────
-- Deliberately different, much larger numbers than `lagMinutes`. That
-- distinction is MODEL-SERVE-006-T04's own: "the lab target's own latency is
-- a different and much longer number". Every column has a default, so an
-- existing InferenceSchedule row backfills to a usable schedule rather than
-- to zero — a zero truth lag would join every window the instant it closed,
-- before any lab result could exist, and report a permanent "no truth yet".
ALTER TABLE "InferenceSchedule"
  ADD COLUMN "truthLagMinutes" INTEGER NOT NULL DEFAULT 1440,
  ADD COLUMN "truthToleranceMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "truthHorizonHours" INTEGER NOT NULL DEFAULT 168;

-- ── 2. The join row ──────────────────────────────────────────────────────
-- One row per window. Sufficient statistics rather than finished metrics, so
-- a rolling metric over N windows is EXACT (never an average of averages)
-- and a metric added to the registry later is backfillable from stored pairs
-- with no second truth fetch.
CREATE TABLE "InferenceWindowTruth" (
    "id" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "targetColumn" TEXT NOT NULL,
    "pairsKey" TEXT,
    "pairsChecksum" TEXT,
    "truthRows" INTEGER NOT NULL,
    "pairedRows" INTEGER NOT NULL,
    "predictionRows" INTEGER NOT NULL,
    "n" INTEGER NOT NULL,
    "sumSe" DOUBLE PRECISION NOT NULL,
    "sumAe" DOUBLE PRECISION NOT NULL,
    "sumSigned" DOUBLE PRECISION NOT NULL,
    "sumActual" DOUBLE PRECISION NOT NULL,
    "sumActualSq" DOUBLE PRECISION NOT NULL,
    "toleranceSeconds" INTEGER NOT NULL,
    "joinedThrough" TIMESTAMP(3) NOT NULL,
    "nextJoinAfter" TIMESTAMP(3),
    "joinAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastJoinedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InferenceWindowTruth_pkey" PRIMARY KEY ("id")
);

-- ── 3. Indexes ───────────────────────────────────────────────────────────
-- One join row per window. This is what makes a re-join an UPDATE rather
-- than a second row: truth is late AND incremental, so a window joined at a
-- 24h lag holding one sample may hold three at 72h, and an insert-once
-- design would freeze every window on its first, thinnest number.
CREATE UNIQUE INDEX "InferenceWindowTruth_windowId_key" ON "InferenceWindowTruth"("windowId");
-- A monitoring series asks by model and time, never by window id.
CREATE INDEX "InferenceWindowTruth_modelId_windowStart_idx" ON "InferenceWindowTruth"("modelId", "windowStart");
-- The sweeper's own selection column (backoff).
CREATE INDEX "InferenceWindowTruth_nextJoinAfter_idx" ON "InferenceWindowTruth"("nextJoinAfter");

-- ── 4. Foreign keys ──────────────────────────────────────────────────────
-- The ONLY FK. `modelId`/`modelVersionId` are denormalised plain columns
-- with no constraint of their own, deliberately: a Model delete cascades
-- onto InferenceWindow, which cascades onto this table, so a second FK to
-- ModelVersion would reintroduce exactly the delete-ordering footgun that
-- forced NO ACTION on InferenceWindow_modelVersionId_fkey and PredictionLog's
-- own copy of it. Nothing here needs referential integrity to ModelVersion
-- that the window row does not already provide.
ALTER TABLE "InferenceWindowTruth" ADD CONSTRAINT "InferenceWindowTruth_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "InferenceWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
