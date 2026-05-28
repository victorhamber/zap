-- Histórico leve: só mensagens capturadas após conexão (webhook + envios pelo Zap)
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "inboxCaptureSince" TIMESTAMP(3);

CREATE TABLE "InboxMessage" (
    "id" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "fromMe" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT NOT NULL DEFAULT 'chat',
    "waMessageId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxMessage_session_waMessageId_key" ON "InboxMessage"("session", "waMessageId");
CREATE INDEX "InboxMessage_session_chatId_timestamp_idx" ON "InboxMessage"("session", "chatId", "timestamp");
