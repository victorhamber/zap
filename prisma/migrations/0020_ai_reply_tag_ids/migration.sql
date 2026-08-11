-- AlterTable
ALTER TABLE "InstanceAiSettings" ADD COLUMN IF NOT EXISTS "replyTagIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Compat: instalações antigas usavam learnTagIds para aprender e responder.
UPDATE "InstanceAiSettings"
SET "replyTagIds" = "learnTagIds"
WHERE COALESCE(array_length("replyTagIds", 1), 0) = 0
  AND COALESCE(array_length("learnTagIds", 1), 0) > 0;
