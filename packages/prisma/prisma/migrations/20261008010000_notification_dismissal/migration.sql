-- Bell history removal, per user: "Clear all" (NotificationReadMarker.clearedAt)
-- and the per-row X (NotificationDismissal). The NotificationEvent rows are
-- shared with every member and with Teams/e-mail delivery history, so they
-- are hidden for one user, never deleted.
--
-- Hand-written, NOT produced by `prisma migrate dev` (history drift makes it
-- offer only `migrate reset`). Trimmed from `prisma migrate diff
-- --from-config-datasource --to-schema` to this change only — the diff also
-- proposes the unrelated, still-pending `InferenceSchedule`
-- `driftThresholdPct` drop, deliberately NOT included. Applied by hand and
-- recorded with `prisma migrate resolve --applied`, not `migrate deploy`.

-- AlterTable
ALTER TABLE "NotificationReadMarker" ADD COLUMN     "clearedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NotificationDismissal" (
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDismissal_pkey" PRIMARY KEY ("userId","eventId")
);

-- CreateIndex
CREATE INDEX "NotificationDismissal_eventId_idx" ON "NotificationDismissal"("eventId");

-- AddForeignKey
ALTER TABLE "NotificationDismissal" ADD CONSTRAINT "NotificationDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDismissal" ADD CONSTRAINT "NotificationDismissal_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
