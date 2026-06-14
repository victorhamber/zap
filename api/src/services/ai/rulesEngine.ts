import type { OfficialLink } from "../../types/ai.js";

export function buildSystemPrompt(params: {
  productContext: string;
  rulesAllowed: string;
  rulesForbidden: string;
  officialLinks: OfficialLink[];
}): string {
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
