-- MODEL-SERVE-001-T28. Per-schedule monitoring bands.
--
-- Every column is NOT NULL WITH A DEFAULT, deliberately: these are SETTINGS,
-- not observations, so every existing schedule has a correct value the moment
-- this applies. That is the opposite of T25's preflight* columns, which are
-- nullable precisely because a null there means "never probed" and no default
-- could honestly stand in for an observation nobody made.
--
-- The defaults reproduce today's behaviour rather than introducing new
-- thresholds: frozenWindows 3 is the three-window span T29 specifies, and
-- frozenTolerancePct 0 means EXACT flatness (range == 0), which is the only
-- scale-invariant value available without reference to a column's training
-- spread.

-- AlterTable
ALTER TABLE "InferenceSchedule" ADD COLUMN     "missingPctWarn" DOUBLE PRECISION NOT NULL DEFAULT 5,
ADD COLUMN     "missingPctAlert" DOUBLE PRECISION NOT NULL DEFAULT 20,
ADD COLUMN     "skipStreakAlert" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "frozenWindows" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "frozenTolerancePct" DOUBLE PRECISION NOT NULL DEFAULT 0;
