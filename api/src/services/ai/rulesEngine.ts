import type { OfficialLink } from "../../types/ai.js";

export function buildSystemPrompt(params: {
  productContext: string;
  officialFacts?: string;
  rulesAllowed: string;
  rulesForbidden: string;
  officialLinks: OfficialLink[];
  clientName?: string | null;
  leadTags?: string[];
}): string {
  const clientNameBlock = params.clientName?.trim()
    ? `Nome cadastrado no CRM: ${params.clientName.trim()}`
    : "Nome cadastrado no CRM: (não informado)";

  const clientNameRules = [
    clientNameBlock,
    "- Se não houver nome cadastrado, cumprimente de forma neutra (ex.: \"Olá!\", \"Oi, tudo bem?\") sem usar nomes próprios.",
    "- Use o nome do CRM somente quando estiver cadastrado acima.",
    "- Nunca use o nome do atendente — nem nomes que aparecem nas mensagens do atendente — como se fossem o nome do cliente.",
    "- Não invente nomes."
  ].join("\n");

  const tags = (params.leadTags ?? []).map((t) => t.trim()).filter(Boolean);
  const tagsBlock =
    tags.length > 0
      ? tags.join(", ")
      : "(nenhuma tag cadastrada no CRM para este lead)";

  const leadTagsRules = [
    `Tags atuais do lead: ${tagsBlock}`,
    "- O significado de cada tag está descrito no Contexto do produto.",
    "- Adapte tom e oferta à fase do lead conforme as tags.",
    "- Não ofereça novamente produtos ou etapas incompatíveis com as tags (ex.: não ofereça teste pago a quem já tem tag de teste pago ou comprador).",
    "- As tags têm prioridade sobre suposições genéricas."
  ].join("\n");

  const conversationRules = [
    "- Use a MEMÓRIA DESTA CONVERSA como contexto gravado do lead (não recomece do zero).",
    "- As MENSAGENS RECENTES são o trecho literal mais atual — continue a partir delas.",
    "- Não repita informações, links ou ofertas já registradas na memória ou no histórico recente.",
    "- Se o cliente já comprou, testou ou recebeu instruções, reconheça e avance no assunto."
  ].join("\n");

  const responseRules = [
    "- Responda primeiro à pergunta direta do cliente (preço, valor, planos, prazo, acesso, suporte).",
    "- Se o cliente enviou várias mensagens seguidas, responda todas em uma única resposta objetiva.",
    "- Não ignore perguntas objetivas para fazer perguntas genéricas de follow-up.",
    "- Não repita frases que você já enviou nesta conversa (ex.: não pergunte de novo se o teste está ok se já perguntou).",
    "- Se o cliente já disse que comprou o teste ou tem tag de teste pago/comprador, não ofereça teste nem pergunte se quer comprar teste.",
    "- Seja conciso: uma mensagem curta que resolve o que o cliente pediu.",
    "- NÃO encerre a mensagem com frases de despedida ou \"estou à disposição\". Pare assim que a pergunta for respondida.",
    "- Proibido no final (e em qualquer lugar como fechamento): \"se precisar de mais\", \"qualquer dúvida\", \"estou à disposição\", \"fico à disposição\", \"me pergunta\", \"me chama\", \"estou aqui se precisar\", \"conte comigo\". Isso parece expulsar o cliente.",
    "- Valores de capital, banca, depósito e conta de corretora/mercado: use DÓLARES (USD / US$). Nunca invente valores em reais (R$) para capital ou banca — se o aprendizado trouxer R$, ignore e use os fatos oficiais ou o histórico em USD.",
    "- Conta CENT: o número grande na tela (ex.: 15.000) NÃO é dólares — é o saldo em \"cents\" (1 USD = 100 na tela). Nunca diga só \"15.000 em conta cent\" sem deixar claro que isso equivale a USD 150. Prefira falar primeiro em dólares: \"USD 150 na conta cent (na plataforma aparece como 15.000)\".",
    "- Conta STANDARD: fale sempre em dólares reais (ex.: USD 3.000). Não misture o número da tela da conta cent com a standard.",
    "- Se for citar o número da tela da conta cent, use a fórmula: valor_em_USD × 100 = número na tela, e diga isso em uma frase curta para não confundir o cliente."
  ].join("\n");

  const linksBlock =
    params.officialLinks.length > 0
      ? params.officialLinks
          .map((l) => `- Gatilho "${l.trigger}": ${l.label || l.trigger} → ${l.url}`)
          .join("\n")
      : "(nenhum link oficial cadastrado)";

  const officialFactsBlock = params.officialFacts?.trim()
    ? params.officialFacts.trim()
    : "(nenhum fato oficial cadastrado — use aprendizado histórico com cautela)";

  return [
    "Você é assistente de atendimento no WhatsApp.",
    "Responda de forma natural e objetiva em português do Brasil.",
    "",
    "## Prioridade das fontes (obrigatório)",
    "1. FATOS OFICIAIS — cadastrados abaixo e no bloco da mensagem do usuário. São a fonte ABSOLUTA: valores, limites e regras fixas do produto.",
    "2. APRENDIZADO DE CONVERSAS ANTERIORES — tom, procedimentos e exemplos reais do atendimento humano, exceto quando conflitar com fatos oficiais.",
    "3. Memória e mensagens recentes desta conversa com o lead.",
    "4. Contexto do produto abaixo — apenas para preencher lacunas.",
    "Nunca invente preços, links ou promessas não confirmadas.",
    "Se o aprendizado histórico contradizer os fatos oficiais, siga SEMPRE os fatos oficiais.",
    "Quando o cliente pedir link oficial, use apenas URLs da lista abaixo.",
    "",
    "## Fatos oficiais (prioridade máxima)",
    officialFactsBlock,
    "## Identificação do cliente",
    clientNameRules,
    "",
    "## Tags do lead (CRM)",
    leadTagsRules,
    "",
    "## Continuidade da conversa",
    conversationRules,
    "",
    "## Como responder",
    responseRules,
    "",
    "## Pode fazer",
    params.rulesAllowed.trim() || "(sem regras extras)",
    "",
    "## Não pode fazer",
    params.rulesForbidden.trim() || "(sem restrições extras)",
    "",
    "## Links oficiais",
    linksBlock,
    "",
    "## Contexto do produto (complementar — menor prioridade que o aprendizado histórico)",
    params.productContext.trim() || "(não informado)"
  ].join("\n");
}

export function validateReplyAgainstRules(
  reply: string,
  rulesForbidden: string
): { ok: true } | { ok: false; reason: string } {
  const forbidden = rulesForbidden
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const lower = reply.toLowerCase();
  for (const rule of forbidden) {
    const needle = rule.toLowerCase();
    if (needle.length >= 4 && lower.includes(needle)) {
      return { ok: false, reason: `Resposta viola regra: ${rule}` };
    }
  }

  const urlPattern = /https?:\/\/[^\s]+/gi;
  const urls = reply.match(urlPattern) ?? [];
  if (urls.length > 0 && forbidden.some((r) => r.toLowerCase().includes("link"))) {
    return { ok: false, reason: "Resposta contém link não autorizado" };
  }

  return { ok: true };
}

export function injectOfficialLinksHint(officialLinks: OfficialLink[]): string {
  if (officialLinks.length === 0) return "";
  return officialLinks.map((l) => `[${l.trigger}] → ${l.url}`).join("; ");
}

function normalizeReplyText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Remove fechamentos que soam como "pode ir embora" — o modelo cola isso
 * por hábito de atendimento genérico / aprendizado antigo.
 */
export function stripDismissiveClosing(reply: string): string {
  let text = reply.trim();
  if (!text) return text;

  const patterns = [
    /\s*(?:se\s+)?(?:precisar|precisarem)\s+de\s+mais[^.!?]*[.!?…]?\s*$/i,
    /\s*(?:qualquer|caso\s+tenha)\s+d[uú]vida[^.!?]*[.!?…]?\s*$/i,
    /\s*(?:fico|estou|estamos)\s+[àa]\s+disposi[cç][aã]o[^.!?]*[.!?…]?\s*$/i,
    /\s*(?:conte\s+comigo|me\s+(?:chama|pergunta|avise)|estou\s+aqui\s+se\s+precisar)[^.!?]*[.!?…]?\s*$/i,
    /\s*(?:se\s+tiver\s+(?:d[uú]vida|alguma\s+d[uú]vida)|pode\s+me\s+chamar)[^.!?]*[.!?…]?\s*$/i
  ];

  for (let i = 0; i < 3; i++) {
    const before = text;
    for (const re of patterns) {
      text = text.replace(re, "").trim();
    }
    if (text === before) break;
  }

  return text || reply.trim();
}

/** Detecta se a resposta repete quase igual uma mensagem recente da IA. */
export function isRepetitiveReply(reply: string, recentReplies: string[]): boolean {
  const norm = normalizeReplyText(reply);
  if (norm.length < 16) return false;

  for (const prev of recentReplies) {
    const p = normalizeReplyText(prev);
    if (p.length < 16) continue;
    if (norm === p) return true;
    const prevHead = p.slice(0, Math.min(48, p.length));
    if (prevHead.length >= 16 && norm.includes(prevHead)) return true;
    // Também detecta quando a nova resposta é um prefixo/trecho de uma anterior
    // (ex.: repetir a mesma abertura cortando o final).
    const newHead = norm.slice(0, Math.min(48, norm.length));
    if (newHead.length >= 16 && p.includes(newHead)) return true;
  }
  return false;
}
