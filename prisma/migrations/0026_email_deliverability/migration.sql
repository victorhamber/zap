ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "emailReplyTo" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "emailPostalAddress" TEXT;

CREATE TABLE IF NOT EXISTS "EmailSuppression" (
  "email" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("email")
);
