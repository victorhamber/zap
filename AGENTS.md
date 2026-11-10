# Zap — guia para IA
<!-- Máx. 60 linhas. Só o que a IA precisa SEMPRE. Detalhe mora em ai-docs/. -->

## O que é
Inbox, fluxos (Hotmart, grupo, tag) e WhatsApp. O motor de WhatsApp é só o WAHA (NOWEB). Painel React, API Fastify, worker BullMQ, Postgres.

## Ciclo de toda mudança — automático, sem o usuário pedir
**Ler** (antes de editar; pare quando souber o suficiente)
1. `ai-docs/STATE.md` — onde paramos · 2. `ai-docs/MAP.md` — índice de arquivos/símbolos (use em vez de explorar o código) · 3. `ai-docs/modules/<x>.md` da área
4. `ARCHITECTURE.md`, `CONVENTIONS.md`, `DECISIONS.md` só sob demanda. Siga o que já está decidido; não redecida.
5. Sem `ai-docs/MAP.md`: rode o `init.py` da skill token-economy, documente a área que vai tocar e então siga com o pedido.

**Mudar** — arquivo novo só na pasta de `CONVENTIONS.md`; não mova arquivo existente sem pedido de reestrutura.

**Gravar** (sem exceção, correção pequena inclusive)
1. Atualize `modules/<x>.md` do que mudou (`Fontes:` diz quais arquivos ele cobre; arquivo sem módulo → crie/estenda um)
2. Reescreva `STATE.md` (≤5 linhas: feito / próximo / bloqueio)
3. Decisão não óbvia → 1 entrada em `DECISIONS.md`
4. `python ai-docs/tools/map_repo.py --check` → resolva o que apontar. Não encerre com documentação velha.

## Não alucinar
- Código e MAP são a verdade. Se o doc divergir, corrija o doc.
- Não afirme função, arquivo, input ou comportamento sem ter conferido no MAP ou no trecho do código.
- Não sabe? Procure (grep/símbolo) ou pergunte. Não preencha lacuna com suposição, nem no código nem no doc.

## Economia de tokens
- Busque antes de abrir. Abra só a faixa de linhas; nunca arquivo inteiro >200 linhas.
- Não releia o que já está no contexto; não leia pastas inteiras; ignore `node_modules`, `vendor`, `dist`, logs, binários.
- Responda com diff/patch e `caminho:linha`; sem repetir o pedido nem resumir o óbvio.
- Tarefa grande → plano curto primeiro; passos pequenos e verificáveis.

## Regras de código
- Arquivos pequenos e coesos (<300 linhas); 1 módulo = 1 responsabilidade; nomes descritivos.
- Cabeçalho de 1–2 linhas em arquivo novo; docstring só na API pública e no "porquê".
- Constantes/config separadas da lógica; sem duplicação; sem dependência nova sem necessidade.
- Não recriar Evolution nem WPPConnect. Não apontar esta sessão WAHA para o Desk nem para o Postiz.

## Comandos
- API: `npm run dev:api` · worker: `npm run dev:worker` · painel: `npm run dev:web`
- Build: `npm run build` · tipos da API: `npm run build:api`
- Testes: `npm test` · banco: `npm run db:generate` e `npm run db:migrate`
