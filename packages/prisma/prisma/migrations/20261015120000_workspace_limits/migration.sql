-- MODEL-SERVE-035. Per-workspace caps an admin sets on
-- /admin/workspaces/[id]/settings. NULL = no limit, so every existing
-- workspace keeps behaving exactly as before.
--
-- Hand-written, NOT produced by `prisma migrate dev` (history drift makes it
-- offer only `migrate reset`). Applied by hand.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "maxModels" INTEGER,
ADD COLUMN "maxMembers" INTEGER;
