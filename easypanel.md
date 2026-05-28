# Deploy no EasyPanel (GitHub)

Repositório: https://github.com/victorhamber/zap

## Serviços necessários (projeto `zap`)

1. **zap-db** — PostgreSQL (database: `zap`)
2. **redis** — Redis
3. **zap** — App (este repo, `Dockerfile`, porta `3000`)
4. **zap-worker** — Worker (`Dockerfile.worker`, mesmas envs, sem domínio)
5. **wppconnect** — já existente (`https://wpp.trajettu.com`)

## App `zap` no EasyPanel

- Fonte: Git → `https://github.com/victorhamber/zap`
- Branch: `main`
- Dockerfile: `Dockerfile`
- Porta: `3000`
- Domínio: `zap.trajettu.com` → HTTP `3000`

## App `zap-worker`

- Mesmo repositório e branch
- Dockerfile: `Dockerfile.worker`
- Sem domínio público

## Variáveis (app `zap` e `zap-worker`)

Use os hosts internos que o EasyPanel mostra em cada serviço.

```env
APP_PUBLIC_URL=https://zap.trajettu.com
NODE_ENV=production
PORT=3000

DATABASE_URL=postgres://postgres:SENHA@zap_zap-db:5432/zap?sslmode=disable
REDIS_URL=redis://default:SENHA@zap_redis:6379

JWT_SECRET=chave-aleatoria-min-32-caracteres
JWT_EXPIRES_IN=7d
ADMIN_EMAIL=admin@trajettu.com
ADMIN_PASSWORD=sua-senha-admin

WPP_BASE_URL=https://wpp.trajettu.com
WPP_SESSION=autofintech
WPP_SECRET_KEY=mesma-do-wppconnect

HOTMART_WEBHOOK_SECRET=
CORS_ORIGIN=https://zap.trajettu.com
```

## Após o primeiro deploy do app `zap`

No terminal do container:

```bash
npm run db:seed
```

Login: `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
