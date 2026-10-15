-- MODEL-SERVE-034. Member-management grants an OWNER can give a STAFF member:
-- MEMBER_ROLE_ASSIGN (switch other non-owner members between STAFF and
-- VIEWER) and MEMBER_INVITE (invite as STAFF or VIEWER). Additive only: no
-- existing member gains anything until an owner ticks a grant.
--
-- Hand-written, NOT produced by `prisma migrate dev` (history drift makes it
-- offer only `migrate reset`). Applied by hand.

-- AlterEnum
ALTER TYPE "WorkspacePermission" ADD VALUE IF NOT EXISTS 'MEMBER_ROLE_ASSIGN';
ALTER TYPE "WorkspacePermission" ADD VALUE IF NOT EXISTS 'MEMBER_INVITE';
