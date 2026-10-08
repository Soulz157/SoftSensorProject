-- MODEL-FLOW-029. Cross-validation for a draft-owned HYPERPARAMETER_SEARCH:
-- every candidate of the job launches as a `cv_expanding` run with this k, and
-- the winner is the lowest `cv_rmse_mean`. Deliberately a NEW column, not the
-- existing "cvFolds" (MODEL-SERVE-026's retrain CV-gap measurement beside
-- chronological candidates). Nullable: every existing job is not CV.
--
-- Hand-written, NOT produced by `prisma migrate dev` (history drift makes it
-- offer only `migrate reset`). Trimmed from `prisma migrate diff
-- --from-config-datasource --to-schema` to this change only.
ALTER TABLE "ModelCandidateJob" ADD COLUMN "nSplits" INTEGER;
