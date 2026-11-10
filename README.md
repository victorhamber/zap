# Zap — inbox, fluxos e WhatsApp (WAHA)

Painel para conectar WhatsApp pelo **WAHA** (NOWEB), conversar no inbox e rodar fluxos (Hotmart, mensagem, mídia, agendamento).

## O que tem no projeto

| Pasta | Conteúdo |
|-------|----------|
| `api/` | API Fastify, webhook WAHA, fila BullMQ |
| `web/` | Inbox, fluxos, QR |
| `prisma/` | Schema Postgres |
| `easypanel.md` | Deploy |

## Variáveis

Copie [`.env.example`](.env.example). Em produção, `WAHA_BASE_URL` é o hostname Docker do WAHA e `ZAP_INTERNAL_URL` é o hostname do Zap.

## Desenvolvimento local

```bash
npm install
cp .env.example .env

npm run db:generate
npm run db:migrate
npm run db:seed

npm run dev:api
npm run dev:worker
npm run dev:web
```

Login: `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Deploy

[easypanel.md](easypanel.md) e [deploy/easypanel-waha.md](deploy/easypanel-waha.md).

## Webhooks

- **Hotmart:** `POST /api/webhooks/hotmart/{flowId}`
- **WhatsApp:** `POST /api/webhooks/waha` — o Zap registra isso na sessão ao conectar

https://github.com/victorhamber/zap
