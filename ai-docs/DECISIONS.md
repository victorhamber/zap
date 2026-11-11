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

## 2026-11-10 — Funil no contato, sem outro CRM
- Contexto: o Deskcomm tem kanban, radar e handoff. O Zap já tem contato, tags, IA e API oficial da Meta.
- Decisão: quatro etapas no `Contact`. Radar e retomada leem a última mensagem. A ficha fica aberta no desktop. A aba Conexão oficial é a instância Meta que já existia.
- Alternativas: copiar o RAG, o time e o multi-tenant do Deskcomm. Recusado.
- Consequência: Hotmart aprovada vai para Comprou. Mensagem recebida só tira de Novo. Retomada só em Em conversa.

## 2026-11-10 — Retomada em até três passos
- Contexto: um único fluxo não cobre a 2ª e a 3ª mensagem. O card de Comprou não dizia o produto, e Perdido não tinha motivo.
- Decisão: três passos com horas e fluxo. A sequência começa quando a última mensagem foi nossa e zera quando a pessoa responde. Compra grava `productName`. Perdido exige `preco`, `sumiu`, `ja_tem` ou `outro`.
- Alternativas: modelo de mensagem da API oficial da Meta. Fica para quando o número sair do QR.
- Consequência: o Dashboard mostra as quatro etapas e o radar. O intervalo 45–120 s do fluxo não muda.
