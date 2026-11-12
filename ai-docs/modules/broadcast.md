# broadcast
Fontes: api/src/services/broadcastPlan.ts, api/src/services/broadcastPlan.test.ts, api/src/services/broadcastDispatch.ts, api/src/services/broadcastFlowTrigger.ts, api/src/routes/broadcast.ts, api/src/worker.ts, api/src/index.ts, api/src/services/waha.ts, api/src/engine/executor.ts, web/src/pages/Broadcast.tsx, web/src/components/message/MessageComposer.tsx, web/src/components/flow/FlowNodeProperties.tsx, web/src/App.tsx, web/src/components/Layout.tsx
Propósito: disparo imediato para grupos e, se marcado, e-mail dos contatos. Não é um fluxo.

## API pública
- `GET /api/broadcast/targets` — grupos do WAHA e quantos contatos têm e-mail.
- `POST /api/broadcast` — `{ parts, groupIds, email, subject }`. `parts` é texto, imagem e vídeo na ordem da mensagem. O primeiro grupo sai na requisição; se o WAHA recusar, a tela mostra o erro. Os seguintes entram na fila.

## Depende de / Usado por
- Depende: `sendText` do WAHA, `sendTransactionalEmail`, fila `zap-broadcast` no worker.
- Usado por: menu Broadcast. A página de e-mails do fluxo está em `modules/email.md`.

## Fluxo
1. A pessoa monta uma mensagem só: texto, imagem e vídeo, nesta ordem. A imagem e o vídeo aparecem na prévia. Pode pedir o texto à IA, subir arquivo ou pegar da biblioteca, marcar grupos e, se quiser, o e-mail.
2. Os grupos vêm de `/groups` e também dos chats `@g.us`, para a lista não ficar vazia quando o endpoint de grupos não devolve nada.
3. O primeiro grupo é enviado na hora, na ordem dos blocos. Imagem e vídeo levam a legenda. Se a menção a todos falhar, o envio tenta de novo sem ela. O próximo grupo espera `groupGapMs` (25–70 s).
4. O e-mail usa a faixa que já existe, 15–45 s, também sorteada. Imagem entra no corpo. Os outros arquivos entram como link. Quem cancelou não recebe.

## Invariantes e armadilhas
- Só entra id `@g.us`. No máximo 80 grupos. A mensagem tem teto de 4000 caracteres.
- A pausa não é fixa. Um grupo que falha não trava os seguintes.
- Não usa a cadência de 45–120 s do fluxo. Não cria fluxo.
- O worker precisa estar no ar. Sem Redis a fila não anda.
- O gatilho Broadcast do fluxo abre uma execução por contato. O bloco Enviar para grupos sai uma vez no disparo. A mensagem ligada depois dele sai nesse mesmo grupo, também uma vez, e não no privado. Pausar o fluxo cancela a continuação que ainda estava na fila.

## Como testar
- `npx tsx --test api/src/services/broadcastPlan.test.ts`
