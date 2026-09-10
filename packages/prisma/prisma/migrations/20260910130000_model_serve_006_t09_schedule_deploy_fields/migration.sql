-- MODEL-SERVE-006-T09 (Pass B). Hand-written, same reason every migration
-- in this repo since 20260901090000_model_serve_001_model_version states:
-- a pre-existing, unrelated drift in this dev DB makes `migrate dev` refuse
-- without a full reset. Applied via `prisma migrate deploy`.
--
-- Adopts the wizard's five deploy-step guardrails onto InferenceSchedule,
-- under the SAME names store/model-pipeline.ts's atoms already use —
-- deliberately not a new vocabulary. Every column has a default matching
-- that atom's own default, so an existing InferenceSchedule row (there are
-- none in production yet, but the migration must be correct regardless)
-- backfills to the same values a fresh wizard visit would show.

ALTER TABLE "InferenceSchedule"
  ADD COLUMN "autoRetrain" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "warnSd" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  ADD COLUMN "criticalSd" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
  ADD COLUMN "driftMonitor" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "driftThresholdPct" DOUBLE PRECISION NOT NULL DEFAULT 10;
