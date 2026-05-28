# Zap — Automação WhatsApp (WPPConnect + editor visual)

Painel para criar fluxos de automação (drag-and-drop) e disparar mensagens via **WPPConnect**.

## Funcionalidades

- Editor visual de fluxos (React Flow)
- Gatilhos: Hotmart, mensagem recebida, teste manual
- Ações: texto, imagem, vídeo, áudio
- Aguardar tempo (minutos/horas/dias) ou data/hora fixa
- Fila BullMQ + Redis para agendamentos longos
- Login admin único

## Variáveis de ambiente

Copie [`.env.example`](.env.example).

## Desenvolvimento local

```bash
npm install
cp .env.example .env
# Configure DATABASE_URL e REDIS_URL

npm run db:generate
npm run db:migrate
npm run db:seed

# Terminal 1 — API
npm run dev:api

# Terminal 2 — Worker (agendamentos)
npm run dev:worker

# Terminal 3 — Frontend
npm run dev:web
```

- API: http://localhost:3000  
- UI: http://localhost:5173  
- Login padrão (seed): `ADMIN_EMAIL` / `ADMIN_PASSWORD` do `.env`

## Deploy EasyPanel

1. **Postgres** — database `zap` dedicado  
2. **Redis** — para BullMQ  
3. **Serviço `zap`** — build `Dockerfile`, domínio `zap.trajettu.com`, envs do `.env.example`  
4. **Serviço `zap-worker`** — build `Dockerfile.worker`, mesmas envs (sem servir UI)

Após deploy:

```bash
npm run db:seed
```

## Webhooks

- **Hotmart:** `POST https://zap.trajettu.com/api/webhooks/hotmart/{flowId}`  
  Header opcional: `x-hotmart-hottok` ou `x-webhook-secret` = `HOTMART_WEBHOOK_SECRET`

- **WPPConnect (mensagens recebidas):** `POST https://zap.trajettu.com/api/webhooks/wppconnect`  
  Configure no `start-session` do WPPConnect.

## Fluxo exemplo (Hotmart)

1. Gatilho Hotmart  
2. Enviar texto (boas-vindas)  
3. Aguardar 2 dias  
4. Enviar texto (follow-up)

Ative o fluxo no painel e configure o webhook na Hotmart com o `flowId` exibido na lista de fluxos.
