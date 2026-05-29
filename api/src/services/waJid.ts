/** Normalização de JIDs WhatsApp (Evolution / Baileys LID vs telefone). */

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
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
  if (jid.endsWith("@lid")) return true;
  return isLikelyInternalLidDigits(digitsOnly(jid));
}

export function isValidWhatsAppPhoneDigits(digits: string): boolean {
  if (digits.length < 10 || digits.length > 15) return false;
  if (isLikelyInternalLidDigits(digits)) return false;
  return true;
}

/** Número para API Evolution (preferir só dígitos do telefone). */
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
