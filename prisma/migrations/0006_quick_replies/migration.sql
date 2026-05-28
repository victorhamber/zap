-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "quickReplies" JSONB NOT NULL DEFAULT '[]';
