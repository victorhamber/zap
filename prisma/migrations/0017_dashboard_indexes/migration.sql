-- Índices usados pelo /api/dashboard/stats (contagens por período).
-- Sem eles, cada carregamento do painel faz seq scan em InboxMessage/FlowRun.
CREATE INDEX IF NOT EXISTS "InboxMessage_timestamp_idx" ON "InboxMessage"("timestamp");
CREATE INDEX IF NOT EXISTS "FlowRun_createdAt_idx" ON "FlowRun"("createdAt");
