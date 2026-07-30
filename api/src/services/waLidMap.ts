import fs from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR, ensureUploadDir } from "./uploads.js";
import {
  digitsOnly,
  isGroupLikeJid,
  isLikelyInternalLidJid,
  isValidWhatsAppPhoneDigits,
  normalizeDirectJid,
  pickBestJid
} from "./waJid.js";

/** Mapeia @lid interno → telefone real (@s.whatsapp.net). */
const mem = new Map<string, string>();
let loadedSession = "";

function storeKey(session: string, jid: string): string {
  return `${session.trim().toLowerCase()}|${normalizeDirectJid(jid.trim())}`;
}

/**
 * v2: mapas gravados antes desta versão podem conter grupos (120363…@lid)
 * apontando para o telefone de um participante. O nome novo do arquivo descarta
 * o cache envenenado de uma vez — ele é reaprendido pelos webhooks.
 */
function mapFile(session: string): string {
  const safe = session.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "default";
  return path.join(UPLOAD_DIR, `wa-lid-map-v2-${safe}.json`);
}

function legacyMapFile(session: string): string {
  const safe = session.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "default";
  return path.join(UPLOAD_DIR, `wa-lid-map-${safe}.json`);
}

/** Grupos/canais nunca entram no mapa: não são telefone nem @lid. */
function jidCandidates(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t || isGroupLikeJid(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export function pickPhoneJid(candidates: string[]): string | null {
  const normalized = candidates
    .map((c) => normalizeDirectJid(c))
    .filter((c) => Boolean(c) && !isGroupLikeJid(c));
  const best = pickBestJid(normalized);
  const d = digitsOnly(best);
  if (best && !best.endsWith("@lid") && isValidWhatsAppPhoneDigits(d)) {
    return best.includes("@") ? best : `${d}@s.whatsapp.net`;
  }
  for (const c of normalized) {
    if (c.endsWith("@lid")) continue;
    const d2 = digitsOnly(c);
    if (isValidWhatsAppPhoneDigits(d2)) {
      return c.includes("@") ? c : `${d2}@s.whatsapp.net`;
    }
  }
  return null;
}

function pickLidJid(candidates: string[]): string | null {
  for (const c of candidates.map((x) => normalizeDirectJid(x))) {
    if (!c || isGroupLikeJid(c)) continue;
    if (c.endsWith("@lid")) return c;
    if (isLikelyInternalLidJid(c)) {
      const d = digitsOnly(c);
      return `${d}@lid`;
    }
  }
  return null;
}

function applyWaJidMapping(session: string, ...rawJids: unknown[]): boolean {
  const norm = session.trim().toLowerCase();
  const candidates = jidCandidates(...rawJids);
  if (candidates.length < 2) return false;

  const phone = pickPhoneJid(candidates);
  const lid = pickLidJid(candidates);
  if (!phone || !lid) return false;

  const key = storeKey(norm, lid);
  const prev = mem.get(key);
  if (prev === phone) return false;
  mem.set(key, phone);
  return true;
}

export async function loadWaLidMap(session: string): Promise<void> {
  const norm = session.trim().toLowerCase();
  if (loadedSession === norm && mem.size > 0) return;

  mem.clear();
  loadedSession = norm;

  try {
    await ensureUploadDir();
    const raw = await fs.readFile(mapFile(norm), "utf8");
    const data = JSON.parse(raw) as Record<string, string>;
    for (const [lid, phone] of Object.entries(data)) {
      if (!lid || !phone) continue;
      // Cinto e suspensório: entrada com grupo dos dois lados é lixo.
      if (isGroupLikeJid(lid) || isGroupLikeJid(phone)) continue;
      mem.set(storeKey(norm, lid), normalizeDirectJid(phone));
    }
  } catch {
    /* primeiro uso */
  }

  // Remove o mapa da v1 (podia ter grupo→telefone de participante).
  await fs.unlink(legacyMapFile(norm)).catch(() => {});
}

async function persistWaLidMap(session: string): Promise<void> {
  const norm = session.trim().toLowerCase();
  const prefix = `${norm}|`;
  const out: Record<string, string> = {};
  for (const [k, v] of mem.entries()) {
    if (!k.startsWith(prefix)) continue;
    const lid = k.slice(prefix.length);
    out[lid] = v;
  }
  await ensureUploadDir();
  await fs.writeFile(mapFile(norm), JSON.stringify(out), "utf8");
}

/** Aprende par @lid ↔ telefone a partir de webhooks / chats Evolution. */
export function recordWaJidMappingSync(session: string, ...rawJids: unknown[]): void {
  applyWaJidMapping(session, ...rawJids);
}

export async function recordWaJidMapping(session: string, ...rawJids: unknown[]): Promise<void> {
  if (!applyWaJidMapping(session, ...rawJids)) return;
  await persistWaLidMap(session.trim().toLowerCase()).catch(() => {});
}

export async function flushWaLidMap(session: string): Promise<void> {
  await persistWaLidMap(session.trim().toLowerCase()).catch(() => {});
}

/** Reset apenas em memória (testes) — não toca no arquivo persistido. */
export function clearWaLidMapMemory(): void {
  mem.clear();
  loadedSession = "";
}

/** Limpa mapeamento @lid ao trocar o número conectado na instância. */
export async function clearWaLidMap(session: string): Promise<void> {
  const norm = session.trim().toLowerCase();
  mem.clear();
  loadedSession = "";
  try {
    await fs.unlink(mapFile(norm));
  } catch {
    /* arquivo inexistente */
  }
}

export function getMappedPhoneJid(session: string, chatId: string): string | null {
  const norm = session.trim().toLowerCase();
  const id = normalizeDirectJid(chatId.trim());
  if (!id) return null;
  // Grupo/canal não tem telefone equivalente — resolver isso puxava a conversa
  // privada de um participante para dentro do grupo.
  if (isGroupLikeJid(id)) return null;

  const direct = mem.get(storeKey(norm, id));
  if (direct) return direct;

  if (id.endsWith("@lid") || isLikelyInternalLidJid(id)) {
    const d = digitsOnly(id);
    const alt = mem.get(storeKey(norm, `${d}@lid`));
    if (alt) return alt;
  }
  return null;
}

/** Todos os @lid conhecidos que apontam para o mesmo telefone (busca reversa). */
export function getLidsMappedToPhone(session: string, phoneJid: string): string[] {
  const norm = session.trim().toLowerCase();
  const target = normalizeDirectJid(phoneJid.trim());
  if (!target) return [];

  const out: string[] = [];
  const prefix = `${norm}|`;
  for (const [k, v] of mem.entries()) {
    if (v !== target || !k.startsWith(prefix)) continue;
    const lid = k.slice(prefix.length);
    if (lid && !out.includes(lid)) out.push(lid);
  }
  return out;
}

export async function expandChatIdVariants(session: string, chatId: string): Promise<string[]> {
  const out: string[] = [];
  const add = (id: string) => {
    const t = id.trim();
    if (t && !out.includes(t)) out.push(t);
  };

  add(chatId);
  const raw = chatId.trim();
  add(raw);
  const digits = digitsOnly(raw.replace(/@.*/, ""));

  // Grupo/canal resolve só para o próprio JID. Nada de variantes de telefone
  // nem de mapa @lid — era assim que mensagens privadas vazavam para o grupo.
  if (isGroupLikeJid(raw)) {
    if (digits && raw.endsWith("@g.us")) add(`${digits}@g.us`);
    return out;
  }

  if (digits) {
    add(`${digits}@c.us`);
    add(`${digits}@lid`);
    add(`${digits}@s.whatsapp.net`);
  }

  const mapped = getMappedPhoneJid(session, chatId);
  if (mapped) {
    add(mapped);
    const md = digitsOnly(mapped);
    if (md) {
      add(`${md}@s.whatsapp.net`);
      add(`${md}@c.us`);
    }
    for (const lid of getLidsMappedToPhone(session, mapped)) {
      add(lid);
    }
  } else if (isValidWhatsAppPhoneDigits(digits)) {
    const phoneJid = `${digits}@s.whatsapp.net`;
    for (const lid of getLidsMappedToPhone(session, phoneJid)) {
      add(lid);
    }
  }

  return out;
}

export function extractEvolutionKeyFields(
  o: Record<string, unknown>
): Record<string, unknown> {
  const lastMsg =
    o.lastMessage && typeof o.lastMessage === "object"
      ? (o.lastMessage as Record<string, unknown>)
      : null;
  const key =
    (lastMsg?.key && typeof lastMsg.key === "object"
      ? (lastMsg.key as Record<string, unknown>)
      : null) ??
    (o.key && typeof o.key === "object" ? (o.key as Record<string, unknown>) : null);

  return {
    remoteJid: o.remoteJid ?? o.jid ?? o.id ?? key?.remoteJid ?? o.chatId,
    remoteJidAlt: o.remoteJidAlt ?? o.remoteJidalt ?? o.pn ?? key?.remoteJidAlt,
    participant: o.participant ?? key?.participant,
    participantAlt: o.participantAlt ?? key?.participantAlt,
    fromMe: key?.fromMe ?? o.fromMe
  };
}
