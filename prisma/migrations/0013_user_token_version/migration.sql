-- Invalida JWTs antigos quando a senha admin muda no deploy
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
-- Sessões emitidas antes desta versão não carregam tv no JWT (tratado como 0)
UPDATE "User" SET "tokenVersion" = 1 WHERE "tokenVersion" = 0;
