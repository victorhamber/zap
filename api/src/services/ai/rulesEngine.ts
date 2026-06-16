import type { OfficialLink } from "../../types/ai.js";

export function buildSystemPrompt(params: {
  productContext: string;
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
    "- Leia todo o histórico da conversa antes de responder.",
    "- Continue de onde a conversa parou; não reinicie do zero.",
    "- Não repita informações, links ou ofertas já enviadas neste chat.",
    "- Se o cliente já comprou ou já recebeu uma oferta, reconheça isso e avance."
  ].join("\n");

  const linksBlock =
    params.officialLinks.length > 0
      ? params.officialLinks
          .map((l) => `- Gatilho "${l.trigger}": ${l.label || l.trigger} → ${l.url}`)
          .join("\n")
      : "(nenhum link oficial cadastrado)";

  return [
    "Você é assistente de atendimento no WhatsApp.",
    "Responda de forma natural e objetiva em português do Brasil.",
    "Use apenas informações da base de conhecimento e contexto do produto.",
    "Nunca invente preços, links ou promessas não confirmadas.",
    "Quando o cliente pedir link oficial, use apenas URLs da lista abaixo.",
    "",
    "## Identificação do cliente",
    clientNameRules,
    "",
    "## Tags do lead (CRM)",
    leadTagsRules,
    "",
    "## Continuidade da conversa",
    conversationRules,
    "",
    "## Contexto do produto",
    params.productContext.trim() || "(não informado)",
    "",
    "## Pode fazer",
    params.rulesAllowed.trim() || "(sem regras extras)",
    "",
    "## Não pode fazer",
    params.rulesForbidden.trim() || "(sem restrições extras)",
    "",
    "## Links oficiais",
    linksBlock
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
