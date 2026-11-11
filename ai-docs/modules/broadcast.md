# broadcast
Fontes: api/src/services/broadcastPlan.ts, api/src/services/broadcastPlan.test.ts, api/src/services/broadcastDispatch.ts, api/src/routes/broadcast.ts, api/src/worker.ts, api/src/index.ts, web/src/pages/Broadcast.tsx, web/src/components/broadcast/BroadcastMediaField.tsx, web/src/App.tsx, web/src/components/Layout.tsx
Propósito: disparo imediato para grupos e, se marcado, e-mail dos contatos. Não é um fluxo.

## API pública
- `GET /api/broadcast/targets` — grupos do WAHA e quantos contatos têm e-mail.
- `POST /api/broadcast` — `{ text, groupIds, email, subject, media }`. `media` é `{ kind, url, filename }` com kind `image`, `video`, `audio` ou `document`. O primeiro de cada canal sai na hora. Sem texto, o arquivo basta.

## Depende de / Usado por
- Depende: `sendText` do WAHA, `sendTransactionalEmail`, fila `zap-broadcast` no worker.
- Usado por: menu Broadcast.

## Fluxo
1. A pessoa escreve a mensagem, pode pedir o texto à IA, anexar arquivo (do computador ou da biblioteca), marcar grupos e, se quiser, o e-mail.
2. Os grupos vêm de `/groups` e também dos chats `@g.us`, para a lista não ficar vazia quando o endpoint de grupos não devolve nada.
3. O worker manda o primeiro grupo agora. Imagem e vídeo levam a legenda e a menção oculta. Áudio sai sem menção; o texto, se houver, vai na mensagem seguinte. Documento sai sem menção. O próximo grupo espera `groupGapMs` (25–70 s, sorteado de novo).
4. O e-mail usa a faixa que já existe, 15–45 s, também sorteada. Imagem entra no corpo. Os outros arquivos entram como link. Quem cancelou não recebe.

## Invariantes e armadilhas
- Só entra id `@g.us`. No máximo 80 grupos. A mensagem tem teto de 4000 caracteres.
- A pausa não é fixa. Um grupo que falha não trava os seguintes.
- Não usa a cadência de 45–120 s do fluxo. Não cria fluxo.
- O worker precisa estar no ar. Sem Redis a fila não anda.

## Como testar
- `npx tsx --test api/src/services/broadcastPlan.test.ts`
