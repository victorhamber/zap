-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "dismissedWppSessions" JSONB NOT NULL DEFAULT '[]';
