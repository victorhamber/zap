# ia
Fontes: api/src/routes/ai.ts, api/src/services/ai/openaiClient.ts, api/src/services/ai/draftCopy.ts, api/src/services/ai/draftCopy.test.ts, web/src/components/ai/AiCopyButton.tsx
Propósito: rascunho de mensagem e de e-mail a partir de um pedido, com imagem ou vídeo de referência.

## API pública
- `POST /api/ai/draft` — `{ channel, audience, goal, brief, mediaUrl }`. `channel` é `whatsapp` ou `email`. `goal` é venda, engajamento, aviso ou relacionamento.
- A resposta traz `text`. No e-mail também `subject`, `preheader` e `html`.

## Depende de / Usado por
- Depende: chave OpenAI da sessão, modelo de visão e Whisper. O arquivo precisa estar em `/uploads`.
- Usado por: Broadcast, mensagem e legenda do fluxo, editor de e-mail.

## Fluxo
1. A pessoa escolhe o objetivo, escreve o pedido e, se quiser, manda imagem ou vídeo.
2. A imagem entra na chamada. O vídeo vira até 4 quadros e o áudio vira texto. Nada disso fica gravado.
3. O texto volta para o campo. No e-mail, assunto, prévia e parágrafos entram no nó.

## Invariantes e armadilhas
- Sem chave da OpenAI o pedido falha. Grupo não recebe `{{name}}`. Pessoa e e-mail podem receber.
- Vídeo acima de 25 MB ou imagem acima de 8 MB não entra. Sem ffmpeg o vídeo não é visto.
- Não inventa preço, prazo ou resultado que não esteja no pedido nem na mídia.

## Como testar
- `npx tsx --test api/src/services/ai/draftCopy.test.ts`
