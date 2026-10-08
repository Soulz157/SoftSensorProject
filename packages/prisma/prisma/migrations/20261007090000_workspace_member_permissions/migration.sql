-- Workspace member feature grants. Read-only features an OWNER can grant a
-- VIEWER (MONITORING_VIEW, NOTIFICATIONS_VIEW). Empty by default, so every
-- existing member keeps exactly the access their role gave them.
--
-- Hand-written, NOT produced by `prisma migrate dev` (history drift makes it
-- offer only `migrate reset`). Generated with `prisma migrate diff
-- --from-config-datasource --to-schema`, trimmed to this change only — the
-- diff also proposed the unrelated, still-pending `InferenceSchedule`
-- `driftThresholdPct` drop, deliberately NOT included. Applied by hand and
-- recorded with `prisma migrate resolve --applied`.

-- CreateEnum
CREATE TYPE "WorkspacePermission" AS ENUM ('MONITORING_VIEW', 'NOTIFICATIONS_VIEW');

-- AlterTable
ALTER TABLE "WorkspaceMember" ADD COLUMN     "permissions" "WorkspacePermission"[] DEFAULT ARRAY[]::"WorkspacePermission"[];
