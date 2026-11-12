# email
Fontes: api/src/services/email/resend.ts, api/src/services/email/deliverability.ts, api/src/services/email/deliverability.test.ts, api/src/services/email/summarizeEmailSteps.ts, api/src/services/email/summarizeEmailSteps.test.ts, api/src/services/email/listEmailDispatches.ts, api/src/routes/emailPublic.ts, api/src/routes/emailDispatch.ts, api/src/routes/settings.ts, api/src/engine/executor.ts, api/src/index.ts, api/src/types/flow.ts, prisma/schema.prisma, prisma/migrations/0026_email_deliverability/migration.sql, web/src/components/email/EmailSettingsPanel.tsx, web/src/components/email/EmailEditorModal.tsx, web/src/components/email/EmailBlockEditor.tsx, web/src/components/email/emailBlocks.ts, web/src/components/flow/FlowNodeProperties.tsx, web/src/components/flow/nodeMeta.ts, web/src/pages/EmailAnalytics.tsx, web/src/App.tsx, web/src/components/Layout.tsx
Propósito: e-mail de fluxo pela Resend, com o que a caixa exige para não tratar como spam.

## API pública
- `sendTransactionalEmail` manda HTML e texto, Reply-To, `List-Unsubscribe` e o POST de um clique.
- `GET/POST /api/email/unsubscribe?t=` é público. Grava o endereço em `EmailSuppression` e o próximo envio ignora.
- `GET /api/settings/email/domain` lê SPF, DKIM e DMARC do domínio do From na Resend.
- `GET /api/email/dispatches` lista o que o fluxo registrou: enviado, cancelado ou falha, por fluxo.

## Depende de / Usado por
- Depende: Resend, `APP_PUBLIC_URL`, `JWT_SECRET` (assina o link de cancelar).
- Usado por: nó `send_email` do fluxo e a aba E-mail nas configurações.

## Fluxo
1. O editor grava HTML e a linha de pré-visualização no nó. A tela tem paleta, o e-mail no centro e as propriedades do bloco selecionado. O popup rola. A imagem pode vir da biblioteca ou de um link. O ícone de IA escreve assunto, prévia e corpo a partir de um pedido, e pode olhar imagem ou vídeo. Sem coluna, rede social, HTML cru nem envio de teste.
2. O envio espera a fila que já existia, consulta o cancelamento e só então chama a Resend.
3. O rodapé leva nome, From, endereço (se preenchido) e o link de cancelar.

## Invariantes e armadilhas
- SPF, DKIM e DMARC são do DNS do domínio. O Zap só mostra o que a Resend já verificou. DMARC a Resend não cria.
- Trocar `JWT_SECRET` invalida links de cancelar já enviados. Os novos e-mails saem com link novo.
- Quem cancelou não recebe de novo. O passo do fluxo segue, com log de que o envio foi ignorado.
- O intervalo entre e-mails continua o que já estava em `EMAIL_DISPATCH_MIN_SEC` / `MAX_SEC`.
- No fluxo, texto, imagem e vídeo ficam no nó `send_message`. Áudio continua no nó próprio. Os nós antigos de texto, imagem e vídeo ainda executam. O menu Broadcast usa essa mesma faixa. O bloco de grupos ligado ao gatilho Broadcast sai uma vez por disparo.

## Como testar
- `npx tsx --test api/src/services/email/deliverability.test.ts`
- `npx tsc -p api/tsconfig.json --noEmit` e `npx tsc -p web/tsconfig.json --noEmit`
