# whatsapp
Fontes: api/src/services/waha.ts, api/src/services/wahaWebhook.ts, api/src/services/whatsapp/index.ts, api/src/routes/webhooks.ts, api/src/routes/settings.ts, api/src/routes/wpp.ts
Propósito: único motor WhatsApp do Zap, o WAHA NOWEB.

## API pública
- `api/src/services/whatsapp/index.ts` reexporta `waha.ts`. Envio, QR, sessão e chats passam por aí.
- Webhook: `POST /api/webhooks/waha`. Eventos `message` e `session.status`.
- Painel ainda chama rotas `/api/wpp/*` e `/api/settings/wpp/*`. Por baixo é WAHA.

## Depende de / Usado por
- Depende: `WAHA_BASE_URL`, `WAHA_API_KEY`, `WHATSAPP_SESSION`, volumes `/app/.sessions` e `/app/.media`.
- Usado por: executor de fluxo, inbox, painel de conexão.

## Fluxo
1. `ensureSession` cria a sessão com store NOWEB ligado se ela não existe. Não dá PUT nesse caminho.
2. QR só quando o status é `SCAN_QR_CODE`: `GET /api/{sessão}/auth/qr?format=image`.
3. Envio: `/api/sendText`, `/api/sendImage`, `/api/sendVideo` (`convert: true`), `/api/sendVoice`.

## Invariantes e armadilhas
- `GET /api/settings/wpp/verify` chama `registerInboundWebhook` quando está conectado. Esse caminho faz PUT na sessão. O Desk não faz PUT em poll: a sessão volta para STARTING. Não repetir isso.
- O validador do WAHA recusa hostname com `_`. Por isso o webhook usa `https://zap.forexrendimento.com/api/webhooks/waha`, não o DNS interno do Easypanel.
- A sessão ativa do inbox é `appSettings.wppSession`, não o default do env, quando a linha existe.
- Grupo: o Desk manda `mentions: ["all"]` e, em link do YouTube, `send/link-custom-preview`. O Zap ainda não faz os dois.
- Não usar a sessão `postiz` nem a do Desk.

## Como testar
- `GET /api/webhooks/waha` → `{ ok: true, provider: "waha" }`.
- Container `waha` com `WHATSAPP_DEFAULT_ENGINE=NOWEB`.
