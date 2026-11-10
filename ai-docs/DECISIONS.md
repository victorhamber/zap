# Decisões — Zap

## 2026-11-10 — Motor é o WAHA, no modelo do Desk
- Contexto: Evolution ocupava API + Postgres + Redis. O Desk (Postiz) já fala com um WAHA NOWEB só.
- Decisão: um container `devlikeapro/waha:latest-2026.7.2`, sem banco próprio. Sem `WHATSAPP_PROVIDER`.
- Alternativas: adaptador em cima da Evolution. Recusado.
- Consequência: QR novo. Sessão deste Zap isolada da sessão `postiz` e da do Desk. Webhook público enquanto o hostname interno tiver `_`.
