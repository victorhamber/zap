-- Sequência de retomada, motivo de perdido e produto da compra
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "lostReason" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "productName" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "followUpStep" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "followUpSteps" JSONB NOT NULL DEFAULT '[]';
