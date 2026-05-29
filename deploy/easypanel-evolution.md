# Zap + Evolution API (EasyPanel — Trajettu)

Substitui o WPPConnect pela [Evolution API v2](https://doc.evolution-api.com).

**Domínios Trajettu**

| Serviço | Domínio público |
|---------|-----------------|
| Zap | `https://zap.trajettu.com` |
| Evolution API | `https://evo.trajettu.com` |

## 1. Serviço Evolution (`evolution-api`)

- Porta interna: **8080**
- Domínio EasyPanel: `evo.trajettu.com` → HTTP `8080`
- Postgres: `zap_evolution-api-db` · Redis: `zap_evolution-api-redis`

Env mínima Evolution (ajuste senhas):

```env
SERVER_URL=https://evo.trajettu.com
AUTHENTICATION_API_KEY=sua-chave-global
DATABASE_CONNECTION_URI=postgres://postgres:SENHA@zap_evolution-api-db:5432/zap?sslmode=disable
CACHE_REDIS_URI=redis://default:SENHA@zap_evolution-api-redis:6379
WEBHOOK_GLOBAL_ENABLED=false
```

## 2. Serviços `zap` e `zap-worker`

Cole **o mesmo bloco** nos dois serviços:

```env
NODE_ENV=production

APP_PUBLIC_URL=https://zap.trajettu.com
ZAP_INTERNAL_URL=http://zap_zap:3000

DATABASE_URL=postgres://postgres:SENHA@zap_zap-db:5432/zap?sslmode=disable
REDIS_URL=redis://default:SENHA@zap_redis:6379

JWT_SECRET=SUA_CHAVE_JWT_MIN_32_CHARS
JWT_EXPIRES_IN=7d

ADMIN_EMAIL=admin@trajettu.com
ADMIN_PASSWORD=SUA_SENHA_ADMIN

CORS_ORIGIN=https://zap.trajettu.com

WHATSAPP_PROVIDER=evolution
WHATSAPP_SESSION=ass

EVOLUTION_BASE_URL=https://evo.trajettu.com
EVOLUTION_INTERNAL_URL=http://zap_evolution-api:8080
EVOLUTION_API_KEY=mesma-chave-do-AUTHENTICATION_API_KEY-da-evolution
```

- `WHATSAPP_SESSION` = nome da instância na Evolution (ex.: `ass`, `454`).
- **Não** use variáveis `WPP_*` — o serviço `wppconnect` foi removido.
- Redeploy **zap** e **zap-worker** após salvar.

## 3. Parar WPPConnect

Pare ou exclua o serviço **wppconnect** no EasyPanel.

## 4. Conectar WhatsApp

1. Painel Zap → **Configurações** → **Conectar / Mostrar QR**
2. O Zap cria a instância na Evolution e registra o webhook:
   - `http://zap_zap:3000/api/webhooks/evolution`
3. Escaneie o QR.

## 5. Teste

- `GET https://evo.trajettu.com` — Evolution no ar
- `GET https://zap.trajettu.com/api/webhooks/evolution` → `{ "ok": true }`
- Mensagem inbound → `lastWebhookSavedAt` atualiza no painel
