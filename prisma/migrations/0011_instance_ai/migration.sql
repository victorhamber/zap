-- InboxMessage.source
ALTER TABLE "InboxMessage" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'webhook';

-- Instance AI settings & data (per WhatsApp session)
CREATE TABLE "InstanceAiSettings" (
    "id" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "learnEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "learnTagIds" TEXT[],
    "learnText" BOOLEAN NOT NULL DEFAULT true,
    "learnImage" BOOLEAN NOT NULL DEFAULT false,
    "learnAudio" BOOLEAN NOT NULL DEFAULT false,
    "learnVideo" BOOLEAN NOT NULL DEFAULT false,
    "replyText" BOOLEAN NOT NULL DEFAULT true,
    "replyImage" BOOLEAN NOT NULL DEFAULT false,
    "replyAudio" BOOLEAN NOT NULL DEFAULT false,
    "replyVideo" BOOLEAN NOT NULL DEFAULT false,
    "productContext" TEXT NOT NULL DEFAULT '',
    "rulesAllowed" TEXT NOT NULL DEFAULT '',
    "rulesForbidden" TEXT NOT NULL DEFAULT '',
    "officialLinks" JSONB NOT NULL DEFAULT '[]',
    "openaiApiKeyEnc" TEXT,
    "modelChat" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "modelVision" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "modelTranscribe" TEXT NOT NULL DEFAULT 'whisper-1',
    "replyDelaySec" INTEGER NOT NULL DEFAULT 60,
    "humanIdleSec" INTEGER NOT NULL DEFAULT 60,
    "maxDailyReplies" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceAiSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstanceAiSettings_session_key" ON "InstanceAiSettings"("session");

CREATE TABLE "InstanceAiKnowledge" (
    "id" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "topic" TEXT,
    "content" TEXT NOT NULL,
    "sourceMsgId" TEXT,
    "modality" TEXT NOT NULL DEFAULT 'text',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceAiKnowledge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstanceAiKnowledge_session_chatId_idx" ON "InstanceAiKnowledge"("session", "chatId");
CREATE INDEX "InstanceAiKnowledge_session_createdAt_idx" ON "InstanceAiKnowledge"("session", "createdAt");

CREATE TABLE "InstanceAiChatState" (
    "session" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'auto',
    "lastHumanAt" TIMESTAMP(3),
    "pendingReplyJobId" TEXT,
    "pendingInboundId" TEXT
);

CREATE UNIQUE INDEX "InstanceAiChatState_session_chatId_key" ON "InstanceAiChatState"("session", "chatId");

CREATE TABLE "InstanceAiEvent" (
    "id" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "chatId" TEXT,
    "event" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceAiEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstanceAiEvent_session_createdAt_idx" ON "InstanceAiEvent"("session", "createdAt");
