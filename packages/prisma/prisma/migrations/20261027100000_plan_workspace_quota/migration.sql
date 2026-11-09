-- MODEL-SERVE-040. Per-workspace model / member quota carried by the plan.
-- NULL = no limit.
ALTER TABLE "Plan" ADD COLUMN "maxModelsPerWorkspace" INTEGER;
ALTER TABLE "Plan" ADD COLUMN "maxMembersPerWorkspace" INTEGER;
