-- MODEL-SERVE-026-T07. The acceptance criteria an operator chose before a
-- retrain started — a stated verdict on the Retrain tab, never a gate on a
-- retrain or a promote. Nullable: every existing job reads as "none chosen".
--
-- Hand-written, NOT produced by `prisma migrate dev` (history drift makes it
-- offer only `migrate reset`). Generated with `prisma migrate diff
-- --from-config-datasource --to-schema`, trimmed to this change only — the
-- diff also proposed the unrelated, still-pending `InferenceSchedule`
-- `driftThresholdPct` drop, deliberately NOT included. Applied by hand and
-- recorded with `prisma migrate resolve --applied`, not `migrate deploy`
-- (which would also run that pending drop migration).

-- AlterTable
ALTER TABLE "ModelCandidateJob" ADD COLUMN     "acceptanceCriteria" JSONB;
