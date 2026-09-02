-- E-mail do lead no CRM (Hotmart/webhook/manual) para {{email}} em fluxos
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "email" TEXT;
