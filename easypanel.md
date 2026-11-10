# Deploy no EasyPanel (GitHub)

Repositório: https://github.com/victorhamber/zap

Motor de WhatsApp: **WAHA** (NOWEB). Guia: [`deploy/easypanel-waha.md`](deploy/easypanel-waha.md).

## Serviços

1. **zap-db** — PostgreSQL (database: `zap`)
2. **redis** — Redis do Zap
3. **zap-api** — este repo, `Dockerfile`, porta `3000`
4. **zap-worker** — `Dockerfile.worker`, mesmas envs, sem domínio
5. **waha** — imagem `devlikeapro/waha`, porta interna `3000`, sem domínio

Não suba Evolution nem WPPConnect. Os dois saíram do código.

## App `zap-api`

- Fonte: Git → `https://github.com/victorhamber/zap`
- Branch: `main` só depois do WAHA existir no painel. Antes disso, use a branch `waha`.
- Dockerfile: `Dockerfile`
- Porta: `3000`
- Domínio: `zap.forexrendimento.com` → HTTP `3000`

## App `zap-worker`

- Mesmo repositório e branch
- **Dockerfile path: `Dockerfile.worker`**
- Sem domínio e sem porta HTTP
- Start: `node api/dist/worker.js`

| Log | Situação |
|-----|----------|
| `Server listening at :3000` no worker | Dockerfile errado |
| `=== zap-worker (processador de filas) ===` | Correto |

## Variáveis (`zap-api` e `zap-worker`)

`ADMIN_PASSWORD` é obrigatória em produção. Sem ela, ou com `admin123`, a API não sobe.

`WHATSAPP_WEBHOOK_SECRET` é opcional. Se preencher, o WAHA precisa mandar o header `x-webhook-secret`. O botão de registrar webhook no painel grava isso na sessão. Confira em `GET /api/webhooks/waha`.

### Volume de uploads

Mídia do inbox fica em `/app/api/uploads`. Sem volume, some a cada redeploy.

| Tipo | Caminho |
|------|---------|
| Volume | `/app/api/uploads` |

```env
APP_PUBLIC_URL=https://zap.forexrendimento.com
ZAP_INTERNAL_URL=http://zap-forexrendimento_zap-api:3000
NODE_ENV=production
PORT=3000

DATABASE_URL=postgres://postgres:SENHA@zap-forexrendimento_zap-db:5432/zap?sslmode=disable
REDIS_URL=redis://default:SENHA@zap-forexrendimento_zap-redis:6379

JWT_SECRET=chave-aleatoria-min-32-caracteres
JWT_EXPIRES_IN=7d
ADMIN_EMAIL=admin@trajettu.com
ADMIN_PASSWORD=sua-senha-admin

WHATSAPP_SESSION=zap
WAHA_BASE_URL=http://zap-forexrendimento_waha:3000
WAHA_API_KEY=mesma-chave-do-container-waha

HOTMART_WEBHOOK_SECRET=
WHATSAPP_WEBHOOK_SECRET=
CORS_ORIGIN=https://zap.forexrendimento.com

FLOW_DISPATCH_STAGGER=true
FLOW_DISPATCH_MIN_SEC=45
FLOW_DISPATCH_MAX_SEC=120

EMAIL_DISPATCH_MIN_SEC=15
EMAIL_DISPATCH_MAX_SEC=45
```

Troque os hostnames se o nome do projeto ou do serviço no EasyPanel for outro. O padrão é `{projeto}_{serviço}`.

## Sessão WhatsApp

O login fica no volume do WAHA (`/app/.sessions` e `/app/.media`), não no banco do Zap. Sem esse volume, cada deploy pede QR de novo.

O Zap cria a sessão com store NOWEB ligado e registra o webhook `POST /api/webhooks/waha`. Não faça PUT na sessão a cada consulta de QR: isso reinicia a sessão.

## Anti-spam

- `FLOW_DISPATCH_STAGGER=true` com 45–120 s entre disparos
- E-mail do fluxo tem fila própria (`EMAIL_DISPATCH_*`)
- Não dispare a base inteira de uma vez

## Depois do primeiro deploy

O bootstrap cria o admin. Login: `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

O worker processa fila de fluxo e de IA. Sem `Dockerfile.worker`, o serviço escuta na porta 3000 e não processa job nenhum.

Quando o QR conectar, apague `evolution-api`, `evolution-db` e `evolution-redis`.
