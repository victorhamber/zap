ALTER TABLE "WppInstance" ADD COLUMN "integration" TEXT NOT NULL DEFAULT 'baileys';
ALTER TABLE "WppInstance" ADD COLUMN "metaPhoneNumberId" TEXT;
ALTER TABLE "WppInstance" ADD COLUMN "metaBusinessId" TEXT;
ALTER TABLE "WppInstance" ADD COLUMN "metaAccessTokenEnc" TEXT;
ALTER TABLE "WppInstance" ADD COLUMN "metaWebhookVerifyTokenEnc" TEXT;
