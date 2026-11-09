-- Refresh-token rotation grace window. A rotated token is now marked revoked
-- (revokedAt) and pointed at its replacement instead of being deleted, so a
-- request that raced the rotation can be answered with the same new token.
--
-- Hand-written, NOT produced by `prisma migrate dev` (history drift makes it
-- offer a reset). Applied by hand to the local DB and not recorded in
-- _prisma_migrations, like the other hand-applied migrations here.
ALTER TABLE "RefreshToken" ADD COLUMN "replacedById" TEXT;
