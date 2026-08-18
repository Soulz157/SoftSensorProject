-- AlterTable
-- Drop the plaintext connection password (moved to encrypted secretCiphertext).
-- Existing rows lose their stored password and must be re-entered via the UI.
ALTER TABLE "DataSource" DROP COLUMN "password",
ADD COLUMN     "config" JSONB,
ADD COLUMN     "secretCiphertext" TEXT NOT NULL DEFAULT '';
