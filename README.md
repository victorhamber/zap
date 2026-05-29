# Zap — WhatsApp, inbox e automações (WPPConnect)

Painel web para conectar WhatsApp via **WPPConnect**, conversar no **inbox** e criar **fluxos visuais** (Hotmart, mensagens, mídia, agendamentos).

## O que tem no projeto

| Pasta | Conteúdo |
|-------|----------|
| `api/` | API Fastify, webhooks, WPPConnect, fila BullMQ |
| `web/` | Interface React (inbox, fluxos, conexão QR) |
| `prisma/` | Schema Postgres e migrations |
| `easypanel.md` | Deploy no EasyPanel (envs, volumes, WPP) |

## Variáveis de ambiente

Copie [`.env.example`](.env.example). Em produção use `ZAP_INTERNAL_URL` com o hostname Docker do serviço Zap (ex.: `http://zap_zap:3000`).

## Desenvolvimento local

```bash
npm install
cp .env.example .env
# DATABASE_URL e REDIS_URL

npm run db:generate
npm run db:migrate
npm run db:seed

npm run dev:api      # terminal 1 — API :3000
npm run dev:worker   # terminal 2 — agendamentos
npm run dev:web      # terminal 3 — UI :5173
```

Login (seed): `ADMIN_EMAIL` / `ADMIN_PASSWORD` do `.env`.

## Deploy

Guia passo a passo: **[easypanel.md](easypanel.md)** (Postgres, Redis, `zap`, `zap-worker`, `wppconnect`, volumes).

## Webhooks

- **Hotmart:** `POST /api/webhooks/hotmart/{flowId}` — header `x-hotmart-hottok` = `HOTMART_WEBHOOK_SECRET`
- **WPPConnect:** `POST /api/webhooks/wppconnect` — registrado ao conectar no painel

## Repositório

https://github.com/victorhamber/zap
