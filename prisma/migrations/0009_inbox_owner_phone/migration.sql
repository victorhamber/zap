-- Histórico do inbox separado por número conectado na instância
ALTER TABLE "AppSettings" ADD COLUMN "inboxOwnerPhone" TEXT;

ALTER TABLE "InboxMessage" ADD COLUMN "ownerPhone" TEXT NOT NULL DEFAULT '';

CREATE INDEX "InboxMessage_session_ownerPhone_chatId_timestamp_idx"
  ON "InboxMessage"("session", "ownerPhone", "chatId", "timestamp");
