/** Normalização de JIDs WhatsApp (Evolution / Baileys LID vs telefone). */

const GENERIC_SELF_CHAT_NAMES = new Set([
  "você",
  "voce",
  "you",
  "meu",
  "eu",
  "myself",
  "eu mesmo",
  "mensagens salvas",
  "message yourself"
]);

/** Nomes genéricos de chat consigo mesmo — não usar em contatos externos. */
export function isGenericSelfChatName(name: string | null | undefined): boolean {
  const n = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!n) return false;
  return GENERIC_SELF_CHAT_NAMES.has(n);
}

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Grupo (@g.us), canal/comunidade (@newsletter) ou lista de transmissão.
 * O "número" desses JIDs (120363…) NÃO é telefone e NÃO é @lid — tratá-lo como
 * um dos dois fazia o grupo ser mapeado para o telefone de um participante,
 * misturando conversa privada com grupo (nomes trocados no inbox).
 */
export function isGroupLikeJid(jid: string | null | undefined): boolean {
  const t = String(jid ?? "").trim().toLowerCase();
  if (!t) return false;
  return (
    t.endsWith("@g.us") ||
    t.includes("@newsletter") ||
    t.endsWith("@broadcast") ||
    t.includes("status@broadcast")
  );
}

/** Status do WhatsApp (não é conversa). O painel mostrava um card "status". */
export function isStatusBroadcastJid(jid: string | null | undefined): boolean {
  const t = String(jid ?? "").trim().toLowerCase();
  return t === "status@broadcast" || t.startsWith("status@");
}

function jidRank(id: string): number {
  if (!id) return 0;
  if (id.endsWith("@g.us") || id.includes("@newsletter")) return 5;
  if (id.endsWith("@s.whatsapp.net") || id.endsWith("@c.us")) return 4;
  if (id.endsWith("@lid")) return 1;
  return 0;
}

export function pickBestJid(candidates: string[]): string {
  return [...new Set(candidates.map((c) => c.trim()).filter(Boolean))].sort(
    (a, b) => jidRank(b) - jidRank(a)
  )[0] ?? "";
}

/** Preferir telefone (@s.whatsapp.net) em vez de @lid interno. */
export function canonicalEvolutionChatId(
  key: Record<string, unknown>,
  payload?: Record<string, unknown>
): string {
  const remoteJid = String(
    key.remoteJid ?? key.remotejid ?? key.id ?? key.jid ?? payload?.id ?? ""
  ).trim();
  const remoteJidAlt = String(
    key.remoteJidAlt ?? key.remoteJidalt ?? key.pn ?? payload?.remoteJidAlt ?? ""
  ).trim();
  const participant = String(key.participant ?? payload?.participant ?? "").trim();
  const participantAlt = String(key.participantAlt ?? payload?.participantAlt ?? "").trim();
  const fromMe = key.fromMe === true || key.fromMe === "true";

  if (remoteJid.endsWith("@g.us") || remoteJidAlt.endsWith("@g.us")) {
    return pickBestJid([remoteJid, remoteJidAlt, participant]);
  }

  const phoneCandidates = [remoteJidAlt, participantAlt, remoteJid, participant];
  if (fromMe) {
    return pickBestJid([remoteJidAlt, remoteJid, participantAlt, participant]);
  }
  return pickBestJid(phoneCandidates);
}

/** Unifica @c.us → @s.whatsapp.net para armazenamento e envio. */
export function normalizeDirectJid(jid: string): string {
  const t = jid.trim();
  if (!t) return t;
  if (t.endsWith("@c.us")) return `${digitsOnly(t)}@s.whatsapp.net`;
  if (t.endsWith("@lid")) return t;
  if (t.includes("@")) return t;
  const d = digitsOnly(t);
  return d ? `${d}@s.whatsapp.net` : t;
}

/** Dígitos que parecem ID interno LID (não telefone BR). */
export function isLikelyInternalLidDigits(digits: string): boolean {
  if (!digits) return true;
  if (digits.length >= 14 && !digits.startsWith("55")) return true;
  if (digits.length > 15) return true;
  return false;
}

export function isLikelyInternalLidJid(jid: string): boolean {
  // Grupo/canal nunca é @lid: 120363…@g.us tem 18 dígitos e caía no heurístico
  // de "id interno", virando chave do mapa @lid→telefone.
  if (isGroupLikeJid(jid)) return false;
  if (jid.endsWith("@lid")) return true;
  return isLikelyInternalLidDigits(digitsOnly(jid));
}

export function isValidWhatsAppPhoneDigits(digits: string): boolean {
  if (digits.length < 10 || digits.length > 15) return false;
  if (isLikelyInternalLidDigits(digits)) return false;
  return true;
}

/** Número para API Evolution (preferir só dígitos do telefone). */
export function isOwnerPhoneDigits(chatDigits: string, ownerDigits: string | null): boolean {
  if (!ownerDigits || !chatDigits) return false;
  return chatDigits === ownerDigits;
}

export function evolutionSendNumber(jid: string, isGroup?: boolean): string {
  const normalized = normalizeDirectJid(jid);
  if (isGroup || normalized.endsWith("@g.us")) {
    return normalized.includes("@") ? normalized : `${digitsOnly(normalized)}@g.us`;
  }
  const d = digitsOnly(normalized);
  if (isValidWhatsAppPhoneDigits(d)) return d;
  if (normalized.includes("@")) return normalized;
  return d;
}
