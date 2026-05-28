# Deploy no EasyPanel (GitHub)

Repositório: https://github.com/victorhamber/zap

## Serviços necessários (projeto `zap`)

1. **zap-db** — PostgreSQL (database: `zap`)
2. **redis** — Redis
3. **zap** — App (este repo, `Dockerfile`, porta `3000`)
4. **zap-worker** — Worker (`Dockerfile.worker`, mesmas envs, sem domínio)
5. **wppconnect** — WPPConnect (`porta 21465`)

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

# URL pública (navegador / documentação)
WPP_BASE_URL=https://wpp.trajettu.com:21465

# OBRIGATÓRIO em produção: URL interna Docker do serviço WPP (nome do app no EasyPanel)
WPP_INTERNAL_URL=http://NOME_DO_SERVICO_WPP:21465

WPP_SESSION=autofintech
WPP_SECRET_KEY=mesma-chave-secretKey-do-wppconnect

HOTMART_WEBHOOK_SECRET=
CORS_ORIGIN=https://zap.trajettu.com
```

Substitua `NOME_DO_SERVICO_WPP` pelo hostname interno que o EasyPanel mostra (ex: `zap_wppconnect` ou `wpp`).

## Persistir sessão WhatsApp no deploy (volume no WPP)

O **token da API** fica no Postgres do Zap (`wppToken`) e **não some** quando você faz deploy só do app `zap`.

O **login do WhatsApp** (arquivos do navegador/Puppeteer) ficam **no container do WPPConnect**. Se esse serviço reiniciar sem volume, o aparelho desconecta.

No serviço **wppconnect** no EasyPanel, monte um volume persistente, por exemplo:

| Caminho no container | Descrição |
|---------------------|-----------|
| `/usr/src/wpp-server/tokens` | Pasta de sessões (nome pode variar conforme a imagem) |
| `/usr/src/wpp-server/userDataDir` | Perfil do Chrome, se existir na sua imagem |

Confira no log ou na documentação da sua imagem WPP qual pasta usar. Depois do volume, **redeploy só do `zap`** não deve mais derrubar o WhatsApp — desde que o container **wppconnect** não seja recriado.

O Zap tenta **reabrir a sessão automaticamente** após cada deploy e **a cada ~2 min** se a conexão cair (watchdog `wppReconnect`), usando o token salvo no Postgres.

Opcional no serviço `zap`:

```env
WPP_AUTO_RECONNECT=true
WPP_RECONNECT_INTERVAL_SEC=120
WPP_RECONNECT_COOLDOWN_SEC=180
WPP_HUMANIZE=true
```

`WPP_AUTO_RECONNECT=false` desliga a reconexão em background. **Fechar sessão** no painel marca `PAUSED` (não reconecta sozinho); **Desconectar** marca `LOGOUT`.

### Reduzir risco de bloqueio (não é garantia)

- Use **um número aquecido**; evite disparos em massa no primeiro dia.
- O Zap espaça chamadas ao WPP (`WPP_HUMANIZE`) e evita `load-messages-in-chat` em loop (muito pesado).
- Prefira o **mesmo IP** do servidor e volume persistente no WPPConnect.
- Não existe “modo invisível” 100%: automação sempre tem risco. O painel imita o Web, mas o WhatsApp pode detectar API não oficial.

## WPPConnect — erros no log (AggregateError / startAllSessions)

Se o log do WPP mostra `AggregateError` ao subir, é falha ao chamar **webhook** ou ao auto-iniciar sessões antigas.

No `config` do WPPConnect, ajuste:

```js
startAllSession: false,
webhook: {
  url: null,
  // ...
},
```

Depois reinicie o WPP. Conecte pelo **Zap → WhatsApp → Conexão / QR**.

O webhook `https://zap.trajettu.com/api/webhooks/wppconnect` é configurado pelo Zap no `start-session` quando você clica em Conectar.

## Após o primeiro deploy do app `zap`

O bootstrap cria o admin automaticamente. Se precisar resetar senha: `npm run db:seed` no terminal do container.

Login: `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Diagnóstico no painel

**WhatsApp → Conexão / QR → Testar ligação Zap → WPP** mostra se token, URL e sessão estão corretos.
