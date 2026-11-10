# Convenções — Zap

## Onde guardar arquivo novo
- Rota HTTP: `api/src/routes/<nome>.ts` e registrar em `api/src/index.ts`
- Regra de negócio: `api/src/services/<nome>.ts`
- Cliente WhatsApp: só `api/src/services/waha.ts` (e `wahaWebhook.ts` para o payload)
- Passo de fluxo: `api/src/engine/`
- Tela: `web/src/pages/` ou `web/src/components/<área>/`
- Schema: `prisma/schema.prisma` e uma migration em `prisma/`
- Deploy: `deploy/` e `easypanel.md`
- Código existente não se move sem pedido de reestrutura

## Nomes
- Arquivo exporta uma função principal e o nome do arquivo é o da função, quando for serviço novo.
- Não criar `evolution.ts`, `wppconnect.ts` nem `WHATSAPP_PROVIDER`.

## Padrões
- Env em `api/src/env.ts`. Nome da variável no doc; nunca o valor.
- Erro de WhatsApp sobe como `Error` com o status do WAHA. O painel não chama o WAHA direto.
- Teste com `node:test` via `npm test` (`api/src/**/*.test.ts`).

## Proibido
- PUT na sessão WAHA a cada consulta de QR ou de status. Isso reinicia a sessão.
- Apagar a sessão porque a lista de grupos veio vazia.
- Apontar `WAHA_BASE_URL` para o WAHA do Desk ou do Postiz.
- Versionar `typebot/` (cópia local de consulta, fora do git).
