-- Funil curto do contato e retomada quando a conversa esfria
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "stage" TEXT NOT NULL DEFAULT 'novo';
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "followUpFiredAt" TIMESTAMP(3);

ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "followUpHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "followUpFlowId" TEXT;
