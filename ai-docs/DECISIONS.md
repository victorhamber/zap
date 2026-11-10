# Decisões — Zap

## 2026-11-10 — Motor é o WAHA, no modelo do Desk
- Contexto: Evolution ocupava API + Postgres + Redis. O Desk (Postiz) já fala com um WAHA NOWEB só.
- Decisão: um container `devlikeapro/waha:latest-2026.7.2`, sem banco próprio. Sem `WHATSAPP_PROVIDER`.
- Alternativas: adaptador em cima da Evolution. Recusado.
- Consequência: QR novo. Sessão deste Zap isolada da sessão `postiz` e da do Desk.

## 2026-11-10 — Webhook interno sem `_`, e grupo no padrão do Desk
- Contexto: o WAHA aceita URL sem TLD, mas recusa `_` no hostname. O poll de status dava PUT e reiniciava a sessão.
- Decisão: alias de rede `zap-api` (`http://zap-api:3000`). PUT do webhook só na criação e em `POST /api/wpp/sync-webhook`. Grupo manda `mentions: ["all"]`. YouTube usa `send/link-custom-preview`. A sessão é `appSettings.wppSession`.
- Alternativas: manter o webhook no site público. Fica só como reserva se o alias não resolver.
- Consequência: no `zap-forexrendimento` o webhook ficou `http://zap-api:3000/api/webhooks/waha`. Esse PUT único devolveu a sessão para `SCAN_QR_CODE`. O intervalo 45–120 s do fluxo não muda.
