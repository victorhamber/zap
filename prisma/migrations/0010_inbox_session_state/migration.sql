-- Estado do inbox (número + início da captura) por instância/sessão WPP
ALTER TABLE "AppSettings" ADD COLUMN "inboxSessionState" JSONB NOT NULL DEFAULT '{}';
