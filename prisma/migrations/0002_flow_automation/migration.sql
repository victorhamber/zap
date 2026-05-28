-- Drop old Automation table if exists
DROP TABLE IF EXISTS "Automation";

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "wppBaseUrl" TEXT NOT NULL DEFAULT 'https://wpp.trajettu.com',
    "wppSession" TEXT NOT NULL DEFAULT 'autofintech',
    "wppToken" TEXT,
    "wppTokenFull" TEXT,
    "connectionStatus" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "graphJson" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FlowRun" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'running',
    "currentNodeId" TEXT,
    "externalId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FlowRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FlowRun_flowId_externalId_key" ON "FlowRun"("flowId", "externalId");
CREATE INDEX "FlowRun_flowId_idx" ON "FlowRun"("flowId");
CREATE INDEX "FlowRun_status_idx" ON "FlowRun"("status");

CREATE TABLE "FlowRunStep" (
    "id" TEXT NOT NULL,
    "flowRunId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlowRunStep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FlowRunStep_flowRunId_idx" ON "FlowRunStep"("flowRunId");

CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "flowRunId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "bullJobId" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledJob_flowRunId_idx" ON "ScheduledJob"("flowRunId");
CREATE INDEX "ScheduledJob_runAt_status_idx" ON "ScheduledJob"("runAt", "status");

ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlowRunStep" ADD CONSTRAINT "FlowRunStep_flowRunId_fkey" FOREIGN KEY ("flowRunId") REFERENCES "FlowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledJob" ADD CONSTRAINT "ScheduledJob_flowRunId_fkey" FOREIGN KEY ("flowRunId") REFERENCES "FlowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
