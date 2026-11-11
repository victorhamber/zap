# crm
Fontes: api/src/services/contactStage.ts, api/src/services/contactStage.test.ts, api/src/services/coldFollowUp.ts, api/src/routes/crm.ts, api/src/services/contactProfile.ts, api/src/services/contacts.ts, api/src/services/inboxStore.ts, api/src/services/flowScheduler.ts, api/src/services/ai/chatState.ts, api/src/services/ai/rulesEngine.ts, api/src/services/ai/replyContext.ts, api/src/services/ai/replyService.ts, api/src/index.ts, api/src/routes/inbox.ts, prisma/schema.prisma, prisma/migrations/0023_contact_stage/migration.sql, web/src/pages/Funnel.tsx, web/src/pages/Settings.tsx, web/src/App.tsx, web/src/components/Layout.tsx, web/src/components/ui.tsx, web/src/components/inbox/WhatsAppInbox.tsx, web/src/components/inbox/ContactProfilePanel.tsx, web/src/components/wpp/WppInstancesManager.tsx
Propósito: funil curto no contato que já existe, radar, retomada e a IA que já responde.

## API pública
- `GET /api/crm/board` — contatos nas etapas Novo, Em conversa, Comprou, Perdido.
- `GET/PUT /api/crm/follow-up` — `followUpHours` (0 desliga) e `followUpFlowId`.
- `PUT /api/contacts/:phone` aceita `stage`. `GET/POST /api/inbox/mode` — `auto` ou `human`.
- `noteInbound` só move `novo` → `em_conversa`. `notePurchase` move para `comprou`.

## Depende de / Usado por
- Depende: `Contact`, `AppSettings`, `queueFlowRunStart`, `listStoredChatSummaries`.
- Usado por: inbox (coluna do contato), página `/funil`, prompt da IA.

## Fluxo
1. Mensagem direta recebida grava e chama `noteInbound`. Compra Hotmart `approved` chama `notePurchase`.
2. No desktop o inbox é lista | conversa | ficha. No celular a ficha continua em overlay.
3. Radar: conversa direta, `lastFromMe === false`, silêncio maior que 2 horas.
4. A cada minuto, `runColdFollowUps` dispara o fluxo uma vez por última mensagem, só se a etapa é `em_conversa`.

## Invariantes e armadilhas
- Não cria outro registro de lead. A etapa fica no `Contact`.
- `comprou` e `perdido` não voltam para `em_conversa` quando chega mensagem.
- A IA já para com `[ESCALADO]`. O botão Assumir só grava `mode: human`. Devolver volta para `auto`.
- Conexão oficial é a instância `business` que já existia. QR continua na sessão WAHA. Não há segundo motor.
- Horas 0 ou fluxo vazio não retomam. Não encurtar o intervalo 45–120 s do fluxo.

## Como testar
- `npx tsx --test api/src/services/contactStage.test.ts`
- `npx tsc -p api/tsconfig.json --noEmit` e `npx tsc -p web/tsconfig.json --noEmit`
