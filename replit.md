# trajettu-zap

WhatsApp automation platform built with Fastify (API), React + Vite (frontend), PostgreSQL via Prisma, and WPPConnect for WhatsApp sessions.

## Architecture

- **`api/`** — Fastify REST API on port 3000
- **`web/`** — React 19 + Vite + Tailwind CSS 4 frontend on port 5000
- **`prisma/`** — PostgreSQL schema and migrations
- **`worker/`** — BullMQ + Redis background job worker

## Stack

- Node.js 20, TypeScript
- Fastify v5 (API), React 19, Vite 6, Tailwind CSS v4
- PostgreSQL via Prisma ORM
- BullMQ + Redis (worker)
- WPPConnect for WhatsApp Web automation

## Development

Two workflows run in parallel:
- **Start application** — `npm run dev:web` (Vite frontend, port 5000)
- **Backend API** — `npm run dev:api` (Fastify API, port 3000)

The frontend proxies `/api/*` to port 3000 via Vite's proxy config.

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Secret for signing JWTs
- `JWT_EXPIRES_IN` — Token lifetime (default: 7d)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — Bootstrap admin credentials
- `WPP_BASE_URL` — Public URL of WPPConnect server
- `WPP_INTERNAL_URL` — Internal URL of WPPConnect (Docker network)
- `WPP_SECRET_KEY` — WPPConnect secret key
- `APP_PUBLIC_URL` — Public URL of this app (used for webhook registration)
- `ZAP_INTERNAL_URL` — Internal URL for inbound webhook (Docker)
- `WPP_START_WAIT_QR` — If true, start-session waits for QR code scan
- `CORS_ORIGIN` — Allowed CORS origin(s), comma-separated (or `*`)

## Deployment

- Build: `npm run build:api && npm run build:web && npm run db:generate`
- Run: `node api/dist/index.js`

## User Preferences

- Keep Portuguese language strings in UI (project is for Brazilian market)
