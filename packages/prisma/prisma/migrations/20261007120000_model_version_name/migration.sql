-- Optional operator label for a model version, renameable from the
-- Versions tab while the version is STAGING. Nullable: every existing
-- version reads as "no label" and keeps rendering as `v{version}` alone.
--
-- Hand-written, NOT produced by `prisma migrate dev` (history drift makes it
-- offer only `migrate reset`). Trimmed to this change only — the diff also
-- proposes the unrelated, still-pending `InferenceSchedule`
-- `driftThresholdPct` drop, deliberately NOT included. Applied by hand and
-- recorded with `prisma migrate resolve --applied`, not `migrate deploy`.

-- AlterTable
ALTER TABLE "ModelVersion" ADD COLUMN     "name" TEXT;
