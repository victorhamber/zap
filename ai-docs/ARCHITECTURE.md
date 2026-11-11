# Arquitetura — Zap
Atualizado: 2026-11-10

## Visão geral
Painel único para conversar no WhatsApp e disparar fluxos (Hotmart, grupo, tag, webhook). A API grava inbox e enfileira jobs. O worker processa fluxo, e-mail e IA. O WhatsApp entra e sai só pelo WAHA.

## Componentes
| Módulo | Responsabilidade | Doc |
|---|---|---|
| whatsapp | Cliente WAHA, QR, webhook, envio | modules/whatsapp.md |
| inbox | Lista, conversa e ficha | modules/inbox.md |
| fluxos | Grafo, executor, filas BullMQ | `api/src/engine/executor.ts`, `api/src/services/flow*.ts` |
| ia | Resposta e aprendizado OpenAI | `api/src/services/ai/` |
| painel | React/Vite | `web/src/` |

## Fluxo
1. O painel autentica na API (`/api`). O worker não serve HTTP.
2. Conexão: a API cria a sessão WAHA e lê o QR em `/api/{sessão}/auth/qr`.
3. Mensagem recebida: WAHA faz POST em `/api/webhooks/waha` → `saveInboxMessage` → fluxos e IA.
4. Envio de fluxo ou inbox: `waha.sendText/Image/Video/Audio`.
5. Hotmart entra em `/api/webhooks/hotmart/:flowId` e cai na mesma fila de disparo.

## Dados e integrações
- Postgres (`DATABASE_URL`) e Redis (`REDIS_URL`) do próprio Zap. O WAHA não tem banco.
- Credenciais só em env no Easypanel: `WAHA_API_KEY`, `JWT_SECRET`, `ADMIN_PASSWORD`. Nunca no git.
- Cloud API da Meta continua em `api/src/services/whatsapp/metaWebhook.ts`. É outro canal, não o motor do QR.

## Fronteiras
- Proibido um segundo cliente WhatsApp (Evolution, WPPConnect, Chrome).
- A sessão deste Zap não é a sessão `postiz` nem a do Desk.
- `zap-worker` usa `Dockerfile.worker`. O Dockerfile da API no worker sobe a porta 3000 e não processa fila.
