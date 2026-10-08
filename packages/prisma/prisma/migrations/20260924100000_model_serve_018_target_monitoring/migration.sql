-- MODEL-SERVE-018: target tag (y) drift/PSI inputs per inference window.
--
-- NON-DESTRUCTIVE. Two nullable JSONB columns, no default, no backfill, no
-- index. Existing rows keep NULL ("target not recorded"), which the monitoring
-- report reads as `target: null`. Kept separate from featureStats /
-- featureHistograms so model health never reads the target.

ALTER TABLE "InferenceWindow"
  ADD COLUMN "targetStats" JSONB,
  ADD COLUMN "targetHistogram" JSONB;
