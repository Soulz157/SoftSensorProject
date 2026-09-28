-- MODEL-SERVE-019. Job-level split stats: the test split's own row count
-- and time range over a retrain job's training artifact, frozen once per
-- job (never per candidate run — see ModelCandidateJob.splitStats' own
-- schema comment). Nullable, additive; no backfill for existing rows.
ALTER TABLE "ModelCandidateJob" ADD COLUMN "splitStats" JSONB;
