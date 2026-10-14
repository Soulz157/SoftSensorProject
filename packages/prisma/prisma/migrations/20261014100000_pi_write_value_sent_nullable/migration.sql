-- MODEL-SERVE-032-T07. Purely additive in effect: relaxes one constraint.
--
-- A rollback that REMOVES a point sends no value, so "sent" is genuinely
-- absent there. Storing a placeholder 0 would read as "rolled back to 0".
-- Every existing row keeps its value; only new ROLLBACK rows may be NULL.
-- Applied by hand (never `migrate dev` here).

-- AlterTable
ALTER TABLE "PiWriteValue" ALTER COLUMN "sentValue" DROP NOT NULL;
