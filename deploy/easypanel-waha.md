# WAHA no EasyPanel

O Zap fala só com o [WAHA](https://waha.devlike.pro/). Um container, motor NOWEB (Baileys, sem Chrome). Não use a sessão de outro projeto (Desk, Postiz).

O celular precisa escanear um QR novo. A sessão antiga da Evolution não migra.

## Serviço `waha`

- Imagem: `devlikeapro/waha:latest-2026.7.2`
- Porta interna: `3000`
- Sem domínio público (o painel do Zap mostra o QR)
- Env:

```env
WAHA_API_KEY=uma-chave-longa
WHATSAPP_DEFAULT_ENGINE=NOWEB
WAHA_DASHBOARD_ENABLED=false
```

- Volumes:

| Caminho no container | Para quê |
|----------------------|----------|
| `/app/.sessions` | login do WhatsApp |
| `/app/.media` | arquivos recebidos |

## Env do `zap-api` e do `zap-worker`

```env
WHATSAPP_SESSION=zap
WAHA_BASE_URL=http://NOME-DO-PROJETO_waha:3000
WAHA_API_KEY=a-mesma-chave-do-container-waha
ZAP_INTERNAL_URL=http://NOME-DO-PROJETO_zap-api:3000
```

`WAHA_BASE_URL` é o DNS interno do EasyPanel: `{projeto}_{serviço}`. No projeto `zap-forexrendimento`, com o serviço chamado `waha`, fica `http://zap-forexrendimento_waha:3000`.

Webhook que o Zap registra na sessão: `POST {ZAP_INTERNAL_URL}/api/webhooks/waha`.

Diagnóstico: `GET https://zap.forexrendimento.com/api/webhooks/waha` deve responder `{ ok: true, provider: "waha" }`.

## O que sai

Depois que o Zap novo estiver no ar e o QR conectar, pare e apague:

- `evolution-api`
- `evolution-db`
- `evolution-redis`

O banco e o Redis do Zap (`zap-db`, `zap-redis`) continuam. Não aponte este WAHA para a sessão `postiz` nem para o WAHA do Desk.
