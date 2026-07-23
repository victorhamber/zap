-- Respostas com mídia da IA (texto + imagem/vídeo/áudio disparados por pergunta-gatilho).
-- JSON, como officialLinks. Idempotente para não quebrar se reaplicada.
ALTER TABLE "InstanceAiSettings"
  ADD COLUMN IF NOT EXISTS "mediaResponses" JSONB NOT NULL DEFAULT '[]';
