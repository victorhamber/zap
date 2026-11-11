# inbox
Fontes: api/src/services/inboxStore.ts, api/src/routes/inbox.ts, web/src/components/inbox/*
Propósito: lista, conversa e ficha no painel. A etapa do contato está em `modules/crm.md`. O motor WAHA está em `modules/whatsapp.md`.

## Invariantes e armadilhas
- Desktop: lista | conversa | ficha. Celular: a ficha abre em overlay. A seta do cabeçalho recolhe; a faixa estreita à direita abre de novo.
- Etiquetas só na ficha (`ContactProfilePanel`). O topo da conversa não repete a faixa. O botão Tags abre o gerenciador.
- Mídia de grupo não grava o arquivo inteiro. A bolha mostra a miniatura jpeg que o WhatsApp já manda. Baixar (`POST /api/inbox/messages/download`) traz o vídeo ou o áudio. Conversa direta continua baixando sozinha.
- Link do YouTube na bolha usa a miniatura do YouTube, sem gravar arquivo.
- Tipo da mídia: mimetype, depois extensão, depois `payload.type`. `hasMedia` sem isso vira documento. Se a linha antiga era `document` ou `chat` e o sync traz imagem, vídeo, áudio ou sticker, `saveInboxMessage` troca o tipo.
- Foto: `getChatPictureDataUrl`. URL quebrada cai nas iniciais (`WhatsAppAvatar`).
- A barra da conversa tem Assumir, Fechar (para a IA), Arquivar (esconde o card), Nota interna e Sugerir resposta. Reservar, convidar e transferir avisam que não há equipe nem agenda. Lembrar e pessoal ficam só neste navegador.
