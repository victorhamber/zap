# whatsapp
Fontes: api/src/services/waha.ts, api/src/services/wahaWebhook.ts, api/src/services/wppMedia.ts, api/src/services/inboxMediaDownload.ts, api/src/services/inboxSync.ts, api/src/services/contactAvatar.ts, api/src/services/waJid.ts, api/src/services/inbox.test.ts, api/src/services/whatsapp/index.ts, api/src/routes/webhooks.ts, api/src/routes/settings.ts, api/src/routes/wpp.ts, api/src/services/inbox.ts, api/src/services/flowDispatch.ts, api/src/engine/executor.ts, api/src/bootstrap.ts, web/src/components/inbox/WhatsAppAvatar.tsx, web/src/components/wpp/*, easypanel.md, deploy/easypanel-waha.md
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
- `GET /api/settings/wpp/verify` e o start da sessão só leem. O PUT do webhook fica em `POST /api/wpp/sync-webhook` e na criação (`ensureSession`). PUT no poll devolve a sessão para STARTING.
- O validador do WAHA (`require_tld: false`) recusa hostname com `_`. No `zap-forexrendimento` o alias `zap-api` já resolve, e o webhook da sessão é `http://zap-api:3000/api/webhooks/waha`. Se `ZAP_INTERNAL_URL` tiver `_`, o código cai no site público.
- A sessão ativa é `appSettings.wppSession` (`getActiveWppSessionName`). Inbox, fluxo e log usam esse nome. O env só entra se a linha não existir. Não criar outra sessão.
- Grupo (`@g.us`): `mentions: ["all"]` em texto, imagem e vídeo. O texto não ganha @. Áudio (`sendVoice`) e documento (`sendFile`) não mandam menção. Link do YouTube: `POST /api/send/link-custom-preview` com oEmbed; se falhar, `sendText` com `linkPreviewHighQuality`.
- O intervalo do fluxo continua 45–120 s. Não usar a sessão `postiz` nem a do Desk.
- Mensagem direta recebida chama `noteInbound`. Compra Hotmart aprovada chama `notePurchase` com o nome do produto. O funil mora em `modules/crm.md`. O e-mail do fluxo mora em `modules/email.md`.
- `parseWahaMessage` (`wahaWebhook.ts`) preenche `mediaUrl` com `media.url`. O tipo da mídia segue mimetype, extensão do arquivo e só então `payload.type`. `hasMedia: true` sem nenhum desses vira `document`.
- Foto de perfil: `GET /api/{sessão}/chats/{id}/picture` devolve JSON `{ url }`, não o arquivo. `getChatPictureDataUrl` baixa essa URL. Grupo sem foto tenta de novo com `?refresh=true` uma vez. `status@broadcast` não entra na lista. Arquivar não apaga chat no WAHA. O sync do histórico não reabre conversa fechada.
- Mídia de grupo (`@g.us`, canal) grava só a miniatura (`jpegThumbnail`, até 80 KB). O arquivo inteiro só entra no Baixar. Conversa direta baixa sozinha. Mídia de uma mensagem: `GET .../messages/{id}?downloadMedia=true`.

## Como testar
- `GET /api/webhooks/waha` → `{ ok: true, provider: "waha" }`.
- Container `waha` com `WHATSAPP_DEFAULT_ENGINE=NOWEB`.
