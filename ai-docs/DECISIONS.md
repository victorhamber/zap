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

## 2026-11-11 — Atendimento em gpt-4o
- Contexto: o Zap respondia com `gpt-4o-mini`. No Deskcomm, ao salvar OpenAI como padrão, "Atender o cliente" mostra `gpt-4o`.
- Decisão: chat e visão passam para `gpt-4o`. A transcrição continua `whisper-1`.
- Alternativas: Claude Sonnet, que é o padrão do Deskcomm quando o provedor é Anthropic. O Zap só tem chave OpenAI.
- Consequência: a migration 0025 troca as linhas que ainda estavam no mini ou no GPT-4.

## 2026-11-11 — Redesign sóbrio e profissional do frontend
- Contexto: a interface continha elementos de templates genéricos de IA (aurora neon no body, logo Z com glow saturado, botões fluorescentes, cantos excessivos).
- Decisão: paleta neutra grafite (#0a0b0f), bordas nítidas de 1px, acento esmeralda sóbrio em botões sólidos e pills de status, cantos de 8px a 12px, marca geométrica sóbria, kanban limpo no funil e indicadores executivos no dashboard.
- Alternativas: manter gradientes com opacidade menor. Recusado para remover completamente a sensação de mockup de IA.
- Consequência: estética executiva e limpa (padrão Linear/Supabase), sem poluição visual.

## 2026-11-11 — Opções do Deskcomm sem equipe
- Contexto: o print do Deskcomm tem empresa e modelo da IA, sugestão para revisar, nota interna, assumir, arquivar, reservar, convidar e transferir.
- Decisão: a lista de empresas e modelos aparece no assistente. Só um id OpenAI grava em `modelChat` e `modelVision`. O padrão segue `gpt-4o`. Reservar, convidar e transferir não ganham backend.
- Consequência: a sugestão não sai sozinha. A nota interna não sai no WhatsApp. O arquivo da conversa está na decisão seguinte.

## 2026-11-11 — Barra da conversa no que o Zap já faz
- Contexto: reservar, convidar, transferir, lembrar e pessoal só mostravam aviso. Arquivar usava o ocultar do CRM, e a lista reabria o card porque ainda havia mensagem.
- Decisão: a barra assume a IA, grava a etapa do funil, arquiva numa lista própria e fecha (IA parada + arquivo). A estrela sugere o texto no campo; quem envia é a pessoa. Nota interna continua fora do WhatsApp.
- Alternativas: copiar agenda e equipe do Deskcomm. Recusado.
- Consequência: arquivado volta só com mensagem nova da pessoa. Fechar deixa a IA parada mesmo depois disso.
