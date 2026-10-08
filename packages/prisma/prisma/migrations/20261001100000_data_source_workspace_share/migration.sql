-- Share data sources within a workspace.
--
-- Hand-written, NOT produced by `prisma migrate dev`: migration history in
-- this repo has drift, so `migrate dev` offers only `migrate reset` (drops the
-- dev DB). Generated with `prisma migrate diff --from-config-datasource
-- --to-schema`, then trimmed to this change only — that diff also proposed
-- `ALTER TABLE "InferenceSchedule" DROP COLUMN "driftThresholdPct"`, which is
-- unrelated drift and deliberately NOT included here.

-- AlterTable
ALTER TABLE "DataSource" ADD COLUMN "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "DataSource_workspaceId_idx" ON "DataSource"("workspaceId");

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: share each existing source with the workspace its CREATOR already
-- used it in — the (non-deleted) workspace holding the most of the creator's
-- own datasets that list this source in "sourceIds", ties broken by the
-- earliest such dataset. Only the creator's datasets count, so a source is
-- never shared into a workspace its owner did not use it in. Sources no
-- dataset uses stay NULL (private) until the creator assigns a workspace.
UPDATE "DataSource" ds
SET "workspaceId" = pick."workspaceId"
FROM (
  SELECT DISTINCT ON (src.id)
    src.id AS "sourceId",
    d."workspaceId"
  FROM "DataSource" src
  JOIN "Dataset" d
    ON src.id = ANY (d."sourceIds")
   AND d."createdById" = src."createdById"
  JOIN "Workspace" w
    ON w.id = d."workspaceId"
   AND w."deletedAt" IS NULL
  GROUP BY src.id, d."workspaceId"
  ORDER BY src.id, COUNT(*) DESC, MIN(d."createdAt") ASC
) pick
WHERE ds.id = pick."sourceId";
