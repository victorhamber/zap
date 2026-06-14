# Deploy no EasyPanel (GitHub)

Repositório: https://github.com/victorhamber/zap

## Serviços necessários (projeto `zap`)

1. **zap-db** — PostgreSQL (database: `zap`)
2. **redis** — Redis
3. **zap** — App (este repo, `Dockerfile`, porta `3000`)
4. **zap-worker** — Worker (`Dockerfile.worker`, mesmas envs, sem domínio)
5. **evolution-api** — Evolution API (`porta 8080`, domínio `evo.trajettu.com`)
6. **evolution-api-db** / **evolution-api-redis** — dependências da Evolution

(O serviço **wppconnect** foi descontinuado neste deploy.)

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

Guia completo Evolution: [`deploy/easypanel-evolution.md`](deploy/easypanel-evolution.md)

```env
APP_PUBLIC_URL=https://zap.trajettu.com
ZAP_INTERNAL_URL=http://zap_zap:3000
NODE_ENV=production
PORT=3000

DATABASE_URL=postgres://postgres:SENHA@zap_zap-db:5432/zap?sslmode=disable
REDIS_URL=redis://default:SENHA@zap_redis:6379

JWT_SECRET=chave-aleatoria-min-32-caracteres
JWT_EXPIRES_IN=7d
ADMIN_EMAIL=admin@trajettu.com
ADMIN_PASSWORD=sua-senha-admin

WHATSAPP_PROVIDER=evolution
WHATSAPP_SESSION=ass
EVOLUTION_BASE_URL=https://evo.trajettu.com
EVOLUTION_INTERNAL_URL=http://zap_evolution-api:8080
EVOLUTION_API_KEY=mesma-chave-AUTHENTICATION_API_KEY-da-evolution

HOTMART_WEBHOOK_SECRET=
CORS_ORIGIN=https://zap.trajettu.com

# Anti-spam: intervalo entre inícios de fluxo (Hotmart + broadcast)
FLOW_DISPATCH_STAGGER=true
FLOW_DISPATCH_MIN_SEC=45
FLOW_DISPATCH_MAX_SEC=120
```

## Evitar restrição por spam no WhatsApp

A punição de ~24h costuma vir de **muitas mensagens automáticas / em massa** para quem não interagiu.

**No EasyPanel (recomendado):**
- `FLOW_DISPATCH_STAGGER=true` com intervalo **45–120 s** (ou mais) entre cada disparo
- Evite broadcast para **toda** a base de contatos de uma vez
- Nos fluxos pós-compra: use **Aguardar 2–4 dias** → bloco **Contato respondeu?**
  - **Saída Sim:** continue o fluxo
  - **Saída Não:** encerre ou tag "Silencioso" (não insista)

**Boas práticas:**
- Máximo ~2–3 mensagens proativas sem resposta do cliente
- Priorize conversas onde o cliente já respondeu (a restrição ainda permite responder)
- Não dispare comunidade/link em massa para listas frias


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
# Opcional: limpar órfãs ao abrir a lista (padrão: false — use o botão no painel)
# WPP_AUTO_PURGE_ORPHANS=true
```

**Instâncias:** **Remover** apaga no painel e no WPP (`clear-session-data`). **Limpar órfãs no WPP** remove sessões que existem no servidor mas não estão cadastradas no painel.

### Excluir sessão no painel não some do servidor (show-all-sessions)

Imagens `wppconnect-server` 2.x (incl. `ibsddev/wppconnect-server:latest`) têm um **bug**: `clear-session-data` apaga a pasta Chrome, mas **não apaga** `tokens/<sessão>.data.json` (path errado no código). O Zap chama a API certa; o WPP responde OK e a sessão continua listada.

**Correção (uma vez no servidor WPP):**

1. No GitHub abra [`deploy/COLE-NO-CONSOLE-WPPCONNECT.sh`](https://github.com/victorhamber/zap/blob/main/deploy/COLE-NO-CONSOLE-WPPCONNECT.sh), **copie o arquivo inteiro** e **cole** no console EasyPanel do **wppconnect** (aba Sh).  
   O script deve imprimir `OK: patch de tokens aplicado.` Se aparecer `ERRO: patch incompleto`, a imagem usa outro layout — use o passo 2 de emergência.
2. **Emergência (limpar agora):** [`deploy/APAGAR-TOKENS-MANUAL.sh`](https://github.com/victorhamber/zap/blob/main/deploy/APAGAR-TOKENS-MANUAL.sh) — cole no console, opcional `export MANTER_SESSAO=nome` antes, reinicie o WPP.
3. **Permanente:** build com `deploy/Dockerfile.wppconnect` (base `ibsddev/wppconnect-server:latest` + patch na imagem).
4. Reinicie o wppconnect → no Zap use **Limpar órfãs** ou **Remover** de novo.

Depois disso, criar/apagar instâncias pelo painel funciona sem apagar volume manualmente.

**QR sozinho após deploy:** o Zap **não** chama mais `start-session` no boot, só se o status era `CONNECTED:…`. Use **Conectar / Mostrar QR** manualmente.

**WPP ainda com `Auto close 60s`:** no serviço **wppconnect**, defina `WPP_AUTO_CLOSE=0` e `WPP_START_ALL_SESSION=false`, reinicie **1 réplica**. Senão o QR some em 60s e aparece `Auto Close Called` no log.

`WPP_AUTO_RECONNECT=false` desliga a reconexão em background. **Fechar sessão** no painel marca `PAUSED` (não reconecta sozinho); **Desconectar** marca `LOGOUT`.

### Reduzir risco de bloqueio (não é garantia)

- Use **um número aquecido**; evite disparos em massa no primeiro dia.
- O Zap espaça chamadas ao WPP (`WPP_HUMANIZE`) em envios.
- **Inbox:** não importa histórico antigo do WhatsApp; mensagens ficam no Postgres desde a conexão (webhook + envios pelo painel).
- Prefira o **mesmo IP** do servidor e volume persistente no WPPConnect.
- Não existe “modo invisível” 100%: automação sempre tem risco. O painel imita o Web, mas o WhatsApp pode detectar API não oficial.

## Checklist — não conecta (faça nesta ordem)

1. **Pare** o `wppconnect` (scale 0). Não redeploy com o volume travado.
2. No volume **`userDataDir`**, apague a pasta **`eatrend`** e **`autofintech`** inteiras (ou só os arquivos `SingletonLock`, `SingletonSocket`, `SingletonCookie` dentro delas).
3. No volume **`tokens`**, apague `eatrend.data.json` e `autofintech.data.json` se existirem.
4. No **config** do WPP (obrigatório):
   - `startAllSession: false` (evita `AggregateError` ao subir)
   - `webhook.url: null`
   - `createOptions.autoClose: 0`
5. **1 réplica** só do wppconnect.
6. **Suba** o wppconnect; espere log sem Code 21.
7. No Zap: **uma** instância ativa (`eatrend` *ou* `autofintech`) → **Conectar / Mostrar QR** → escaneie em até 30s.
8. Não clique em **Listar grupos/chats** nas ferramentas antes do QR conectar (gera `req.client.* is not a function` no log).

O aviso `punycode` no Node é inofensivo. `Auto Close Called` / `qrReadError` = escaneou tarde ou `autoClose` ainda em 60s — use `autoClose: 0`.

## Chrome travado: `profile appears to be in use` / Code 21

Se o log do **wppconnect** mostra `Failed to launch the browser process: Code: 21` ou `The profile appears to be in use by another Chromium process`, o perfil no volume ficou **bloqueado** (arquivo `SingletonLock` de um container antigo). O Zap **não consegue** abrir QR até isso ser corrigido no WPP.

**Passo a passo (EasyPanel):**

1. **Pare** o serviço `wppconnect` (scale 0 ou Stop — não só redeploy).
2. Abra o **volume** montado em `/usr/src/wpp-server/userDataDir` (ou o caminho da sua imagem).
3. Para cada sessão com problema (`autofintech`, `eatrend`, etc.):
   - **Opção A:** apague só `SingletonLock`, `SingletonSocket`, `SingletonCookie` dentro da pasta da sessão.
   - **Opção B:** apague a pasta inteira da sessão (ex.: `userDataDir/autofintech`) — vai precisar escanear QR de novo.
4. (Opcional) No volume `tokens`, apague `autofintech.data.json` se existir e a sessão estiver inconsistente.
5. Confirme **apenas 1 réplica** do serviço wppconnect (duas réplicas = dois Chromes no mesmo volume = lock de novo).
6. **Suba** o wppconnect de novo.
7. No Zap: **Desconectar** → **Conectar / Mostrar QR**.

Env no WPP (sem espaço após vírgula):

```env
PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox
```

## WPPConnect — erros no log (AggregateError / startAllSessions)

Se o log mostra `AggregateError` em `startAllSessions` ao subir, o **`startAllSession` ainda está `true`** e o WPP tenta abrir todas as sessões + webhook ao iniciar — **o QR não aparece direito** até corrigir isso.

**No console do container** (não cole JavaScript solto no shell):

```sh
find /usr/src/wpp-server -name "config.ts" -o -name "config.js" 2>/dev/null | head -5
```

Edite o arquivo encontrado (`vi` ou `nano`) e garanta:

```js
startAllSession: false,
webhook: { url: null, /* ... */ },
createOptions: { autoClose: 0, browserArgs: [ /* ... */ ] },
```

Ou use o script em `deploy/wppconnect-config-fix.sh` (copie para o container e rode com `sh`).

Depois **reinicie só o wppconnect** (1 réplica). O aviso `punycode` é inofensivo.

Erros `getAllGroups` / `listChats` com `req.client` undefined = Inbox ou **Ferramentas WPP** chamadas **sem** QR conectado — não use até conectar.

Depois reinicie o WPP. Conecte pelo **Zap → WhatsApp → Conexão / QR** (não abra Inbox antes).

### Várias sessões no log (`[84]`, `[12122]`, `[123]` ao mesmo tempo)

Cada nome de instância abre um Chrome separado. **Use só uma instância ativa** no painel (ex.: `eatrend` *ou* `123`) e **não** clique várias vezes em Conectar — isso gera `browser is already running` e `req.client.logout is not a function`.

Antes de novo QR: pare o wppconnect, apague pastas antigas em `userDataDir/` que não usa mais, suba de novo com **1 réplica**.

### QR expira / `Auto Close Called` / `qrReadError` no log

Enquanto o log mostrar `Auto close configured to 60s`, o WPP **ainda não** está com `autoClose: 0` — corrija o config e **reinicie** o container (redeploy não basta se o config estiver em volume antigo).

Por padrão o WPPConnect fecha o Chrome **60 segundos** após abrir o QR (`autoClose: 60000`). Se você demorar para escanear, o celular pode parecer conectado mas o Zap mostra “sem conexão”.

No **config do serviço wppconnect** (arquivo `config.ts` ou variável da imagem), dentro de `createOptions`:

```js
createOptions: {
  autoClose: 0, // 0 = desliga timeout; ou 300000 para 5 minutos
  browserArgs: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    // ... demais args da sua imagem
  ],
},
```

Reinicie o **wppconnect** após alterar. Escaneie o QR **logo** após aparecer no painel.

O Zap usa `start-session` com `waitQrCode: false` (não bloqueia a API) e faz polling do QR/status a cada 5s.

O webhook é configurado pelo Zap no `start-session` quando você conecta. Com `ZAP_INTERNAL_URL`, o WPP usa a URL interna (ex.: `http://zap_zap:3000/api/webhooks/wppconnect`) — evita falha quando o container WPP não alcança a URL pública.

Teste rápido: `GET https://zap.trajettu.com/api/webhooks/wppconnect` deve retornar `{ ok: true }`. Após uma mensagem recebida, `lastWebhookAt` aparece nessa resposta.

No painel: **Atualizar webhook** (Conexão / QR) re-registra a URL no WPP.

### Não recebe mensagens (só envia)

O Inbox **não puxa histórico** do WhatsApp — só grava o que o **wppconnect** envia por POST para o Zap.

Checklist:

1. No serviço **zap**, `ZAP_INTERNAL_URL` = hostname Docker do Zap (ex. `http://zap_zap:3000`) — **obrigatório**.
2. `WPP_INTERNAL_URL` no zap apontando para o wppconnect (ex. `http://zap_wppconnect:21465`).
3. Após conectar o QR: **Atualizar webhook** no painel.
4. Envie uma mensagem **de outro número** (ou de um contato) **para** o WhatsApp vinculado — não só do painel Zap.
5. Confira `GET /api/webhooks/wppconnect` (público): após a mensagem, `lastWebhookAt` deve atualizar.
6. Apagar o **volume** do wppconnect não apaga o Postgres do Zap, mas a sessão precisa de **novo QR** e **novo webhook** (passo 3).

Se o volume do wppconnect foi recriado, monte de novo `userDataDir` e `tokens` para não perder a sessão a cada deploy.

Opcional no **wppconnect** (`dist/config.js` ou patch): `webhook.url` = mesma URL interna (`http://zap_zap:3000/api/webhooks/wppconnect`) e `onSelfMessage: true` se quiser ver mensagens enviadas pelo próprio celular no Inbox.

## Após o primeiro deploy do app `zap`

O bootstrap cria o admin automaticamente. Se precisar resetar senha: `npm run db:seed` no terminal do container.

Login: `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Diagnóstico no painel

**WhatsApp → Conexão / QR → Testar ligação Zap → WPP** mostra se token, URL e sessão estão corretos.
