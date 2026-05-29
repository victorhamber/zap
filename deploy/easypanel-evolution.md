# Zap + Evolution API (EasyPanel)

Substitui o WPPConnect pela [Evolution API v2](https://doc.evolution-api.com).

## 1. Serviço Evolution

- Imagem oficial Evolution API v2 (ex.: `atendai/evolution-api` ou build da comunidade).
- Porta interna típica: **8080**
- Volume persistente para instâncias (se a imagem usar `/evolution/instances` ou similar).

Gere uma **API Key global** (`AUTHENTICATION_API_KEY` na Evolution) e anote.

## 2. Serviços Zap e zap-worker

```env
WHATSAPP_PROVIDER=evolution

EVOLUTION_BASE_URL=https://evo.seudominio.com
EVOLUTION_INTERNAL_URL=http://nome_servico_evolution:8080
EVOLUTION_API_KEY=sua-chave-global-evolution

ZAP_INTERNAL_URL=http://zap_zap:3000
WPP_SESSION=ass

# Não precisa mais (pode remover ou deixar):
# WPP_BASE_URL, WPP_SECRET_KEY, WPP_INTERNAL_URL
```

- `WPP_SESSION` = **nome da instância** na Evolution (ex.: `ass`, `454`).
- Redeploy **zap** e **zap-worker** após alterar env.

## 3. Parar / desligar WPPConnect (opcional)

Para não gastar RAM com Chrome/Puppeteer, pare o serviço **wppconnect** no EasyPanel.

## 4. Conectar WhatsApp

1. Painel Zap → **Configurações** → **Conectar / Mostrar QR**
2. O Zap cria a instância na Evolution (se não existir) e registra o webhook:
   - `http://zap_zap:3000/api/webhooks/evolution`
3. Escaneie o QR.

## 5. Webhook manual (se precisar)

Na Evolution (Manager ou API):

```http
POST /webhook/set/{instanceName}
apikey: SUA_KEY

{
  "webhook": {
    "enabled": true,
    "url": "http://zap_zap:3000/api/webhooks/evolution",
    "events": ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED", "SEND_MESSAGE"]
  }
}
```

## 6. Teste

- `GET https://zap.seudominio.com/api/webhooks/evolution` → `ok: true`
- Envie mensagem para o número conectado → `lastWebhookSavedAt` deve atualizar
- Inbox e fluxos usam o mesmo painel

## Voltar para WPPConnect

```env
WHATSAPP_PROVIDER=wppconnect
```

Redeploy zap + zap-worker.
