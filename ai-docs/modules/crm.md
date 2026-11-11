# crm
Fontes: api/src/services/contactStage.ts, api/src/services/contactStage.test.ts, api/src/services/coldFollowUp.ts, api/src/services/coldFollowUp.test.ts, api/src/routes/crm.ts, api/src/routes/dashboard.ts, api/src/services/contactProfile.ts, api/src/services/contacts.ts, api/src/services/inboxStore.ts, api/src/services/flowScheduler.ts, api/src/services/ai/chatState.ts, api/src/services/ai/rulesEngine.ts, api/src/services/ai/replyContext.ts, api/src/services/ai/replyService.ts, api/src/services/ai/settings.ts, api/src/services/ai/openaiClient.ts, api/src/index.ts, api/src/routes/inbox.ts, prisma/schema.prisma, prisma/migrations/0023_contact_stage/migration.sql, prisma/migrations/0024_followup_sequence/migration.sql, prisma/migrations/0025_chat_model_gpt4o/migration.sql, web/src/pages/Funnel.tsx, web/src/pages/Dashboard.tsx, web/src/pages/Settings.tsx, web/src/App.tsx, web/src/components/Layout.tsx, web/src/components/ui.tsx, web/src/components/inbox/WhatsAppInbox.tsx, web/src/components/inbox/ContactProfilePanel.tsx, web/src/components/wpp/WppInstancesManager.tsx, web/src/components/wpp/WppConnectPanel.tsx, web/src/components/ai/AiAssistantPanel.tsx, web/src/pages/FlowEditor.tsx, web/src/pages/FlowRuns.tsx, web/src/pages/FlowsList.tsx, web/src/pages/Login.tsx, web/src/pages/MediaLibrary.tsx, web/src/styles.css
Propósito: funil curto no contato que já existe, radar, retomada e a IA que já responde.

## API pública
- `GET /api/crm/board` — contatos nas etapas Novo, Em conversa, Comprou, Perdido.
- `GET/PUT /api/crm/follow-up` — até 3 passos `{ hours, flowId }`. Sem fluxo, o passo não entra.
- `PUT /api/contacts/:phone` aceita `stage` e, em perdido, `lostReason` (`preco`, `sumiu`, `ja_tem`, `outro`).
- `noteInbound` só move `novo` → `em_conversa` e zera a retomada. `notePurchase` move para `comprou` e grava `productName`.
- `GET /api/dashboard/stats` inclui `funnel` com as quatro etapas e o radar (direta, última mensagem da pessoa, mais de 2 h).

## Depende de / Usado por
- Depende: `Contact`, `AppSettings`, `queueFlowRunStart`, `listStoredChatSummaries`.
- Usado por: inbox (coluna do contato), página `/funil`, prompt da IA.

## Fluxo
1. Mensagem direta recebida grava e chama `noteInbound`. Compra Hotmart `approved` chama `notePurchase`.
2. No desktop o inbox é lista | conversa | ficha. No celular a ficha continua em overlay.
3. Radar: conversa direta, `lastFromMe === false`, silêncio maior que 2 horas.
4. A cada minuto, `runColdFollowUps` manda o próximo passo se a etapa é `em_conversa`, a última mensagem foi nossa e o silêncio do passo estourou. Uma resposta da pessoa zera `followUpStep`.

## Invariantes e armadilhas
- Não cria outro registro de lead. A etapa fica no `Contact`.
- `comprou` e `perdido` não voltam para `em_conversa` quando chega mensagem.
- A IA já para com `[ESCALADO]`. O botão Assumir só grava `mode: human`. Devolver volta para `auto`.
- Conexão oficial é a instância `business` que já existia. QR continua na sessão WAHA. Não há segundo motor.
- Passo sem fluxo não dispara. Não encurtar o intervalo 45–120 s do fluxo. O 1º passo não sai se a pessoa falou por último.
- O funil mostra 20 cards por coluna e pede o motivo antes de marcar Perdido. A aba Conexão oficial avisa que o número no ar é o do QR.
- O atendimento usa `gpt-4o`. Quem ainda estava em `gpt-4o-mini` migra na 0025. O áudio continua no Whisper.
- O visual adota paleta sóbria e moderna em grafite (#0a0b0f), bordas nítidas de 1px, sem gradientes neon de IA. Cards, funil, dashboard e formulários usam componentes unificados de ui.tsx.
- Foto do contato: `getChatPictureDataUrl` (`waha.ts`) lê o JSON `{ url }` do WAHA e baixa a imagem. Se a URL quebrar, `WhatsAppAvatar` cai para as iniciais.
- Mensagem com mídia: o tipo sai de mimetype, depois do nome do arquivo, depois de `payload.type`. `hasMedia` sem isso continua documento. No sync, a URL do WAHA é gravada no disco. Se a linha antiga era `document` ou `chat` e a nova é imagem, vídeo, áudio ou sticker, `saveInboxMessage` troca o tipo (`inboxStore.ts`).
- Etiquetas do contato só na ficha (`ContactProfilePanel`). O topo da conversa não repete a faixa. O botão Tags continua abrindo o gerenciador. No desktop a ficha recolhe pela seta do cabeçalho e volta pela faixa estreita à direita.
- O e-mail do fluxo, o cancelamento e o rodapé estão em `modules/email.md`.

## Como testar
- `npx tsx --test api/src/services/contactStage.test.ts api/src/services/coldFollowUp.test.ts`
- `npx tsc -p api/tsconfig.json --noEmit` e `npx tsc -p web/tsconfig.json --noEmit`
