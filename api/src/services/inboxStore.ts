import { prisma } from "../prisma.js";
import { extractWaId, type NormalizedChat, type NormalizedMessage } from "./inbox.js";
import { persistInboundMedia } from "./mediaConvert.js";
import { isPersistedUploadUrl, toPublicMediaUrl } from "./uploads.js";
import {
  captionFromText,
  isLikelyBase64Payload,
  labelForMediaType,
  mimeFromMessageType
} from "./mediaText.js";
import { phoneDedupeKey, expandPhoneLookupKeys, canonicalBrazilPhone } from "../utils/phone.js";
import {
  isGroupLikeJid,
  isStatusBroadcastJid,
  isValidWhatsAppPhoneDigits,
  normalizeDirectJid,
  isLikelyInternalLidJid
} from "./waJid.js";
import {
  expandChatIdVariants,
  getLidsMappedToPhone,
  getMappedPhoneJid,
  loadWaLidMap,
  pickPhoneJid,
  recordWaJidMapping
} from "./waLidMap.js";

export type InboxMessageSource = "webhook" | "manual" | "flow" | "ai";

/** Corpo genérico gravado quando o parser não conseguiu hidratar template/botão. */
function isButtonPlaceholderBody(body: string): boolean {
  const t = body.replace(/^\uFEFF/, "").trim();
  return (
    /^(📄\s*)?(Mensagem com botões|Mensagem interativa|Lista)$/i.test(t) ||
    /^📄\s*Template:/i.test(t) ||
    /^📄\s*Mensagem interativa/i.test(t) ||
    t.includes("não chega pela Evolution") ||
    t.includes("nao chega pela Evolution")
  );
}

function isPrismaUniqueConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function chatIdVariants(chatId: string): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    const t = id.trim();
    if (t && !out.includes(t)) out.push(t);
  };

  add(chatId);
  const raw = extractWaId(chatId) || chatId;
  add(raw);
  const digits = digitsOnly(raw);
  if (!digits) return out;

  // Grupo/canal: só o próprio JID. Gerar `<digits>@lid` / `@s.whatsapp.net`
  // a partir de um 120363…@g.us cruzava o grupo com conversas privadas.
  if (isGroupLikeJid(raw) || isGroupLikeJid(chatId)) {
    if (raw.endsWith("@g.us") || chatId.includes("@g.us")) add(`${digits}@g.us`);
    return out;
  }

  add(`${digits}@c.us`);
  add(`${digits}@lid`);
  add(`${digits}@s.whatsapp.net`);
  if (raw.includes("@") && !out.includes(raw)) add(raw);
  return out;
}

/** JIDs alternativos para sync na Evolution (@lid vs @s.whatsapp.net). */
export function messageSyncJidCandidates(chatId: string, isGroup?: boolean): string[] {
  const digits = digitsOnly(chatId.replace(/@.*/, ""));
  const seed = isGroup && !isGroupLikeJid(chatId) && digits ? `${digits}@g.us` : chatId;
  return [...new Set(chatIdVariants(seed).map((id) => normalizeDirectJid(id)).filter(Boolean))];
}

async function chatIdVariantsResolved(session: string, chatId: string): Promise<string[]> {
  await loadWaLidMap(session);
  return expandChatIdVariants(session, chatId);
}

/** Todos os chatId do Postgres + variantes JID para o mesmo contato (fluxo vs webhook). */
export async function resolveAllChatIdsForContact(
  session: string,
  chatId: string
): Promise<string[]> {
  const normSession = session.trim().toLowerCase();
  const variants = await chatIdVariantsResolved(normSession, chatId);
  const out = new Set(variants);

  if (!prisma) return [...out];

  // Grupos/comunidades resolvem SÓ para o próprio JID. O número de um grupo
  // (120363…@g.us) não é telefone; tratá-lo como tal e casar por prefixo
  // (startsWith) puxava conversas PRIVADAS de membros para dentro do grupo.
  if (chatId.includes("@g.us") || chatId.includes("@newsletter")) {
    return [...out];
  }

  const rawDigits = digitsOnly(chatId.replace(/@.*/, ""));
  const phoneKeys = rawDigits.length >= 10 ? expandPhoneLookupKeys(canonicalBrazilPhone(rawDigits)) : [];

  if (phoneKeys.length > 0) {
    const rows = await prisma.inboxMessage.findMany({
      where: {
        session: normSession,
        OR: phoneKeys.flatMap((k) => [
          { chatId: { startsWith: k } },
          { chatId: k }
        ])
      },
      select: { chatId: true },
      distinct: ["chatId"]
    });
    for (const r of rows) out.add(r.chatId);
  }

  const primary = preferPrimaryChatId([...out]);
  if (primary) {
    for (const lid of getLidsMappedToPhone(session, primary)) {
      out.add(lid);
    }
    const lidRows = await prisma.inboxMessage.findMany({
      where: { session: normSession, chatId: { endsWith: "@lid" } },
      select: { chatId: true },
      distinct: ["chatId"]
    });
    for (const r of lidRows) {
      const mapped = getMappedPhoneJid(normSession, r.chatId);
      if (mapped && out.has(mapped)) out.add(r.chatId);
    }
  }

  return [...out];
}

function preferPrimaryChatId(ids: string[]): string {
  if (ids.length === 0) return "";
  const normalized = [...new Set(ids.map((id) => normalizeDirectJid(id.trim())).filter(Boolean))];
  // Se um grupo/canal aparecer na lista, ele é o dono da conversa — nunca deixe
  // um telefone de participante virar o chatId canônico do grupo.
  const groupId = normalized.find((id) => isGroupLikeJid(id));
  if (groupId) return groupId;
  const score = (id: string): number => {
    if (id.endsWith("@s.whatsapp.net")) return 100;
    if (id.endsWith("@c.us")) return 90;
    if (id.endsWith("@lid")) return 20;
    return 50;
  };
  return normalized.sort((a, b) => score(b) - score(a))[0] ?? "";
}

/** ID único por contato — telefone @s.whatsapp.net ou grupo @g.us. */
export async function canonicalizeChatId(
  session: string,
  chatId: string,
  peerJids: string[] = []
): Promise<string> {
  await recordWaJidMapping(session, chatId, ...peerJids).catch(() => {});
  const resolved = await resolveStorageChatId(session, chatId, peerJids);
  const primary = await findPrimaryChatIdForContact(session, resolved);
  return primary || normalizeDirectJid(chatId.trim());
}

/** ChatId canônico para gravar envios (fluxo, manual) no mesmo fio da conversa existente. */
export async function findPrimaryChatIdForPhone(
  session: string,
  phone: string
): Promise<string> {
  const digits = canonicalBrazilPhone(phone.replace(/\D/g, ""));
  const fallback = digits ? `${digits}@s.whatsapp.net` : phone.trim();
  return findPrimaryChatIdForContact(session, fallback);
}

export async function findPrimaryChatIdForContact(
  session: string,
  chatId: string
): Promise<string> {
  const ids = await resolveAllChatIdsForContact(session, chatId);
  const primary = preferPrimaryChatId(ids) || chatId.trim();
  return normalizeDirectJid(primary) || primary;
}

async function getSessionName(): Promise<string> {
  const { defaultWhatsAppSession } = await import("../env.js");
  if (!prisma) return defaultWhatsAppSession();
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return (s?.wppSession ?? defaultWhatsAppSession()).trim().toLowerCase();
}

export async function getInboxSessionName(): Promise<string> {
  return getSessionName();
}

/** Corrige sessão salva com maiúsculas (mensagens não apareciam no inbox). */
export async function normalizeInboxSessionKeys(): Promise<void> {
  if (!prisma) return;
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (!s?.wppSession) return;
  const norm = s.wppSession.trim().toLowerCase();
  if (s.wppSession === norm) return;
  await prisma.inboxMessage.updateMany({
    where: { session: s.wppSession },
    data: { session: norm }
  });
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { wppSession: norm }
  });
}

type CanonicalGroup = { canonical: string; variants: Set<string> };

async function buildCanonicalGroups(session: string): Promise<CanonicalGroup[]> {
  if (!prisma) return [];
  await loadWaLidMap(session);

  const distinct = await prisma.inboxMessage.findMany({
    where: { session },
    select: { chatId: true },
    distinct: ["chatId"]
  });

  const byCanonical = new Map<string, Set<string>>();

  for (const { chatId } of distinct) {
    const variants = await resolveAllChatIdsForContact(session, chatId);
    const canonical = await findPrimaryChatIdForContact(session, chatId);
    const set = byCanonical.get(canonical) ?? new Set<string>();
    for (const v of variants) set.add(v);
    byCanonical.set(canonical, set);
  }

  return [...byCanonical.entries()].map(([canonical, variants]) => ({ canonical, variants }));
}

async function dedupeInboxRows(session: string, chatId: string): Promise<number> {
  if (!prisma) return 0;

  const rows = await prisma.inboxMessage.findMany({
    where: { session, chatId },
    orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }],
    select: { id: true, waMessageId: true, fromMe: true, type: true, body: true, timestamp: true }
  });

  const seen = new Set<string>();
  const deleteIds: string[] = [];

  for (const row of rows) {
    const sec = Math.floor(row.timestamp.getTime() / 1000);
    const key = row.waMessageId
      ? `wa:${row.waMessageId}`
      : row.fromMe && row.type === "chat"
        ? `${row.fromMe}|${row.type}|${row.body}|${sec}`
        : `${row.fromMe}|${row.type}|${row.body}|${sec}|${row.id}`;
    if (seen.has(key)) {
      deleteIds.push(row.id);
    } else {
      seen.add(key);
    }
  }

  if (deleteIds.length === 0) return 0;
  await prisma.inboxMessage.deleteMany({ where: { id: { in: deleteIds } } });
  return deleteIds.length;
}

async function dedupeInboxByWaMessageId(session: string): Promise<number> {
  if (!prisma) return 0;

  const dupRows = await prisma.$queryRaw<Array<{ waMessageId: string }>>`
    SELECT "waMessageId"
    FROM "InboxMessage"
    WHERE "session" = ${session} AND "waMessageId" IS NOT NULL
    GROUP BY "waMessageId"
    HAVING COUNT(*) > 1
  `;

  let removed = 0;
  for (const { waMessageId } of dupRows) {
    const rows = await prisma.inboxMessage.findMany({
      where: { session, waMessageId },
      orderBy: { createdAt: "asc" },
      select: { id: true }
    });
    const toDelete = rows.slice(1).map((r) => r.id);
    if (toDelete.length === 0) continue;
    await prisma.inboxMessage.deleteMany({ where: { id: { in: toDelete } } });
    removed += toDelete.length;
  }
  return removed;
}

async function consolidateAiChatStatesForGroup(
  session: string,
  canonical: string,
  variants: Set<string>
): Promise<void> {
  if (!prisma) return;

  const ids = [...variants];
  const states = await prisma.instanceAiChatState.findMany({
    where: { session, chatId: { in: ids } }
  });
  if (states.length === 0) return;

  const score = (s: (typeof states)[number]) =>
    Math.max(
      s.lastHumanAt?.getTime() ?? 0,
      s.summaryUpdatedAt?.getTime() ?? 0,
      s.conversationSummary ? 1 : 0
    );

  const sorted = [...states].sort((a, b) => score(b) - score(a));
  const best = sorted[0];
  const merged = {
    mode: sorted.some((s) => s.mode === "human") ? "human" : best.mode,
    lastHumanAt: sorted.reduce<Date | null>((max, s) => {
      if (!s.lastHumanAt) return max;
      if (!max || s.lastHumanAt > max) return s.lastHumanAt;
      return max;
    }, null),
    pendingReplyJobId: sorted.find((s) => s.pendingReplyJobId)?.pendingReplyJobId ?? null,
    pendingInboundId: sorted.find((s) => s.pendingInboundId)?.pendingInboundId ?? null,
    conversationSummary:
      sorted.find((s) => s.conversationSummary.trim())?.conversationSummary ??
      best.conversationSummary,
    summaryMessageCount: Math.max(...sorted.map((s) => s.summaryMessageCount)),
    summaryUpdatedAt: sorted.reduce<Date | null>((max, s) => {
      if (!s.summaryUpdatedAt) return max;
      if (!max || s.summaryUpdatedAt > max) return max;
      return max;
    }, null),
    memoryLastMessageId:
      sorted.find((s) => s.memoryLastMessageId)?.memoryLastMessageId ?? best.memoryLastMessageId
  };

  await prisma.instanceAiChatState.upsert({
    where: { session_chatId: { session, chatId: canonical } },
    create: { session, chatId: canonical, ...merged },
    update: merged
  });

  const staleIds = ids.filter((id) => id !== canonical);
  if (staleIds.length > 0) {
    await prisma.instanceAiChatState.deleteMany({
      where: { session, chatId: { in: staleIds } }
    });
  }
}

/**
 * Unifica histórico fragmentado (@lid, @c.us, @s.whatsapp.net) em um único chatId por contato.
 * Idempotente — roda no bootstrap e pode ser chamado de novo com segurança.
 */
export async function consolidateInboxChatIds(
  sessionName?: string
): Promise<{ merged: number; deduped: number }> {
  if (!prisma) return { merged: 0, deduped: 0 };

  const session = (sessionName ?? (await getSessionName())).trim().toLowerCase();
  const groups = await buildCanonicalGroups(session);

  let merged = 0;
  let contentDeduped = 0;
  for (const { canonical, variants } of groups) {
    const stale = [...variants].filter((id) => id !== canonical);
    if (stale.length > 0) {
      const moved = await prisma.inboxMessage.updateMany({
        where: { session, chatId: { in: stale } },
        data: { chatId: canonical }
      });
      merged += moved.count;

      await prisma.instanceAiKnowledge.updateMany({
        where: { session, chatId: { in: stale } },
        data: { chatId: canonical }
      });
    }

    await consolidateAiChatStatesForGroup(session, canonical, variants);
    contentDeduped += await dedupeInboxRows(session, canonical);
  }

  const waDeduped = await dedupeInboxByWaMessageId(session);
  const deduped = contentDeduped + waDeduped;
  console.log(`[inbox] consolidate session=${session} merged=${merged} deduped=${deduped}`);

  return { merged, deduped };
}

async function getCaptureSince(): Promise<Date | null> {
  const session = await getSessionName();
  const state = await getSessionInboxState(session);
  return state.captureSince;
}

async function getStoredOwnerPhone(): Promise<string | null> {
  const session = await getSessionName();
  const state = await getSessionInboxState(session);
  return state.ownerPhone;
}

export async function getInboxCaptureSince(): Promise<Date | null> {
  return getCaptureSince();
}

type SessionInboxState = {
  ownerPhone?: string;
  captureSince?: string;
  /** phoneDedupeKey ou id:@lid — contatos removidos do CRM do inbox */
  hiddenContacts?: string[];
  /** Arquivados: somem da lista e voltam quando a pessoa manda mensagem. */
  archivedContacts?: string[];
};

function parseInboxSessionState(raw: unknown): Record<string, SessionInboxState> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, SessionInboxState>;
}

async function getSessionInboxState(session: string): Promise<{
  ownerPhone: string | null;
  captureSince: Date | null;
}> {
  if (!prisma) return { ownerPhone: null, captureSince: null };
  const norm = session.trim().toLowerCase();
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (!settings) return { ownerPhone: null, captureSince: null };

  const map = parseInboxSessionState(settings.inboxSessionState);
  const entry = map[norm];
  if (entry?.ownerPhone || entry?.captureSince) {
    return {
      ownerPhone: entry.ownerPhone?.trim() || null,
      captureSince: entry.captureSince ? new Date(entry.captureSince) : null
    };
  }

  const active = (settings.wppSession ?? "").trim().toLowerCase();
  if (active === norm) {
    return {
      ownerPhone: settings.inboxOwnerPhone?.trim() || null,
      captureSince: settings.inboxCaptureSince ?? null
    };
  }

  return { ownerPhone: null, captureSince: null };
}

async function setSessionInboxState(
  session: string,
  data: { ownerPhone: string; captureSince: Date }
): Promise<void> {
  if (!prisma) return;
  const norm = session.trim().toLowerCase();
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const map = parseInboxSessionState(settings?.inboxSessionState);
  map[norm] = {
    ...map[norm],
    ownerPhone: data.ownerPhone,
    captureSince: data.captureSince.toISOString()
  };

  const active = (settings?.wppSession ?? "").trim().toLowerCase();
  await prisma.appSettings.update({
    where: { id: "default" },
    data: {
      inboxSessionState: map,
      ...(active === norm
        ? {
            inboxOwnerPhone: data.ownerPhone,
            inboxCaptureSince: data.captureSince
          }
        : {})
    }
  });
}

function hiddenKeysForContact(phone: string, chatId?: string): string[] {
  const out = new Set<string>();
  const raw = phone.replace(/@.*/, "").replace(/\D/g, "") || phone.replace(/@.*/, "");
  const keys = raw.length >= 10 ? expandPhoneLookupKeys(canonicalBrazilPhone(raw)) : [];
  for (const k of keys) {
    const d = digitsOnly(k);
    if (isValidWhatsAppPhoneDigits(d)) out.add(`p:${phoneDedupeKey(d)}`);
  }
  const cid = chatId?.trim();
  if (cid) {
    const norm = normalizeDirectJid(cid);
    out.add(`id:${norm}`);
    if (norm.endsWith("@lid") || isLikelyInternalLidJid(norm)) {
      out.add(`id:${norm}`);
    }
  }
  return [...out];
}

/** Todas as chaves de visibilidade para um contato (@lid, telefone, variantes BR). */
export async function collectHiddenKeysForContact(
  session: string,
  phone: string,
  chatId?: string
): Promise<string[]> {
  const out = new Set(hiddenKeysForContact(phone, chatId));
  const seed =
    chatId?.trim() ||
    (phone.includes("@") ? phone : `${canonicalBrazilPhone(phone.replace(/\D/g, ""))}@s.whatsapp.net`);
  const variants = await resolveAllChatIdsForContact(session, seed);
  for (const vid of variants) {
    const norm = normalizeDirectJid(vid);
    out.add(`id:${norm}`);
    const d = digitsOnly(norm.replace(/@.*/, ""));
    if (isValidWhatsAppPhoneDigits(d)) {
      out.add(`p:${phoneDedupeKey(d)}`);
      for (const lk of expandPhoneLookupKeys(d)) {
        const ld = digitsOnly(lk);
        if (isValidWhatsAppPhoneDigits(ld)) out.add(`p:${phoneDedupeKey(ld)}`);
      }
    }
  }
  return [...out];
}

export function isChatHiddenFromInbox(
  chat: { id: string; phone: string; isGroup: boolean; kind?: string },
  hidden: Set<string>,
  session?: string
): boolean {
  if (hidden.size === 0) return false;

  const idNorm = normalizeDirectJid(chat.id);
  // Grupos só somem se o próprio JID foi ocultado (ex.: "Apagar conversa").
  if (chat.isGroup || chat.kind === "group" || chat.kind === "community") {
    return hidden.has(`id:${idNorm}`) || hidden.has(`id:${chat.id}`);
  }
  if (hidden.has(`id:${idNorm}`)) return true;

  if (session) {
    const mapped = getMappedPhoneJid(session, chat.id);
    if (mapped) {
      const md = digitsOnly(mapped);
      if (isValidWhatsAppPhoneDigits(md) && hidden.has(`p:${phoneDedupeKey(md)}`)) return true;
    }
  }

  const candidates = [digitsOnly(chat.id.replace(/@.*/, "")), digitsOnly(chat.phone)];
  for (const d of candidates) {
    if (!isValidWhatsAppPhoneDigits(d)) continue;
    if (hidden.has(`p:${phoneDedupeKey(d)}`)) return true;
    for (const lk of expandPhoneLookupKeys(d)) {
      const ld = digitsOnly(lk);
      if (isValidWhatsAppPhoneDigits(ld) && hidden.has(`p:${phoneDedupeKey(ld)}`)) return true;
    }
  }

  return false;
}

async function readInboxSessionMap(): Promise<Record<string, SessionInboxState>> {
  if (!prisma) return {};
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return parseInboxSessionState(settings?.inboxSessionState);
}

async function writeInboxSessionMap(map: Record<string, SessionInboxState>): Promise<void> {
  if (!prisma) return;
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { inboxSessionState: map }
  });
}

/** Contatos ocultos do inbox (removidos do CRM — ainda existem no WhatsApp). */
export async function getHiddenInboxContactKeys(session?: string): Promise<Set<string>> {
  const map = await readInboxSessionMap();
  const out = new Set<string>();
  // Escopo por sessão: ocultos de outra instância não devem sumir conversas da atual.
  if (session) {
    const entry = map[session.trim().toLowerCase()];
    for (const k of entry?.hiddenContacts ?? []) out.add(k);
    return out;
  }
  for (const entry of Object.values(map)) {
    for (const k of entry.hiddenContacts ?? []) out.add(k);
  }
  return out;
}

export async function hideContactFromInbox(
  session: string,
  phone: string,
  chatId?: string
): Promise<void> {
  const norm = session.trim().toLowerCase();
  const map = await readInboxSessionMap();
  const entry = map[norm] ?? {};
  const hidden = new Set(entry.hiddenContacts ?? []);
  for (const k of await collectHiddenKeysForContact(session, phone, chatId)) hidden.add(k);
  map[norm] = { ...entry, hiddenContacts: [...hidden] };
  await writeInboxSessionMap(map);
}

export async function unhideContactFromInbox(
  session: string,
  phone: string,
  chatId?: string
): Promise<void> {
  const norm = session.trim().toLowerCase();
  const map = await readInboxSessionMap();
  const entry = map[norm];
  if (!entry?.hiddenContacts?.length) return;
  // Usa o mesmo conjunto de chaves gerado ao ocultar (telefone + @lid + variantes),
  // senão o contato continua oculto por chaves residuais após nova mensagem.
  const remove = new Set(await collectHiddenKeysForContact(session, phone, chatId));
  // Cinto: qualquer id: residual do chatId cru / normalizado.
  if (chatId?.trim()) {
    const cid = normalizeDirectJid(chatId);
    remove.add(`id:${cid}`);
    remove.add(`id:${chatId.trim()}`);
  }
  const phoneDigits = digitsOnly(phone.replace(/@.*/, ""));
  if (isValidWhatsAppPhoneDigits(phoneDigits)) {
    remove.add(`p:${phoneDedupeKey(phoneDigits)}`);
    for (const lk of expandPhoneLookupKeys(phoneDigits)) {
      const ld = digitsOnly(lk);
      if (isValidWhatsAppPhoneDigits(ld)) remove.add(`p:${phoneDedupeKey(ld)}`);
    }
  }
  const hidden = entry.hiddenContacts.filter((k) => !remove.has(k));
  map[norm] = { ...entry, hiddenContacts: hidden.length > 0 ? hidden : undefined };
  await writeInboxSessionMap(map);
}

export async function getArchivedInboxContactKeys(session?: string): Promise<Set<string>> {
  const map = await readInboxSessionMap();
  const out = new Set<string>();
  if (session) {
    const entry = map[session.trim().toLowerCase()];
    for (const k of entry?.archivedContacts ?? []) out.add(k);
    return out;
  }
  for (const entry of Object.values(map)) {
    for (const k of entry.archivedContacts ?? []) out.add(k);
  }
  return out;
}

export async function archiveContactFromInbox(
  session: string,
  phone: string,
  chatId?: string
): Promise<void> {
  const norm = session.trim().toLowerCase();
  const map = await readInboxSessionMap();
  const entry = map[norm] ?? {};
  const archived = new Set(entry.archivedContacts ?? []);
  for (const k of await collectHiddenKeysForContact(session, phone, chatId)) archived.add(k);
  map[norm] = { ...entry, archivedContacts: [...archived] };
  await writeInboxSessionMap(map);
}

export async function unarchiveContactFromInbox(
  session: string,
  phone: string,
  chatId?: string
): Promise<void> {
  const norm = session.trim().toLowerCase();
  const map = await readInboxSessionMap();
  const entry = map[norm];
  if (!entry?.archivedContacts?.length) return;
  const remove = new Set(await collectHiddenKeysForContact(session, phone, chatId));
  if (chatId?.trim()) {
    const cid = normalizeDirectJid(chatId);
    remove.add(`id:${cid}`);
    remove.add(`id:${chatId.trim()}`);
  }
  const phoneDigits = digitsOnly(phone.replace(/@.*/, ""));
  if (isValidWhatsAppPhoneDigits(phoneDigits)) {
    remove.add(`p:${phoneDedupeKey(phoneDigits)}`);
    for (const lk of expandPhoneLookupKeys(phoneDigits)) {
      const ld = digitsOnly(lk);
      if (isValidWhatsAppPhoneDigits(ld)) remove.add(`p:${phoneDedupeKey(ld)}`);
    }
  }
  const archived = entry.archivedContacts.filter((k) => !remove.has(k));
  map[norm] = { ...entry, archivedContacts: archived.length > 0 ? archived : undefined };
  await writeInboxSessionMap(map);
}

async function resolveStorageChatId(
  session: string,
  chatId: string,
  peerJids: string[] = []
): Promise<string> {
  // Grupo/canal grava sempre no próprio JID. Antes o `participant` do peerJids
  // era tratado como telefone do chat e a mensagem do grupo caía na conversa
  // privada daquele participante (mensagens com nome trocado).
  if (isGroupLikeJid(chatId)) return normalizeDirectJid(chatId);
  await recordWaJidMapping(session, chatId, ...peerJids);
  const mapped = getMappedPhoneJid(session, chatId);
  if (mapped) return normalizeDirectJid(mapped);
  const phone = pickPhoneJid([chatId, ...peerJids]);
  if (phone) {
    await recordWaJidMapping(session, chatId, phone, ...peerJids);
    return normalizeDirectJid(phone);
  }
  return normalizeDirectJid(chatId);
}

export type InboxOwnerSyncResult = {
  phone: string | null;
  changed: boolean;
  previousPhone: string | null;
};

/**
 * Sincroniza o número conectado na instância (metadado de exibição).
 * O histórico do CRM permanece ligado à session — trocar o chip não apaga conversas.
 */
export async function ensureInboxOwnerPhone(): Promise<InboxOwnerSyncResult> {
  if (!prisma) return { phone: null, changed: false, previousPhone: null };

  const session = await getSessionName();
  const sessionKey = session.trim().toLowerCase();
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const map = parseInboxSessionState(settings?.inboxSessionState);
  const hadSessionEntry = Boolean(map[sessionKey]);
  const previous = await getSessionInboxState(session);
  const previousPhone = previous.ownerPhone;

  const wpp = await import("./whatsapp/index.js");
  wpp.clearEvolutionInstanceCache();
  const check = await wpp.verifyActiveSession();
  if (!check.connected) {
    return { phone: previousPhone, changed: false, previousPhone };
  }

  const phone = await wpp.getConnectedOwnerDigits();
  if (!phone) {
    return { phone: previousPhone, changed: false, previousPhone };
  }

  if (previousPhone === phone && hadSessionEntry) {
    return { phone, changed: false, previousPhone };
  }

  const captureSince = previous.captureSince ?? new Date();
  await setSessionInboxState(session, { ownerPhone: phone, captureSince });

  if (!hadSessionEntry) {
    const { clearWaLidMap } = await import("./waLidMap.js");
    await clearWaLidMap(session);
  }

  return { phone, changed: false, previousPhone };
}

async function resolveOwnerPhoneForSave(session: string, explicit?: string | null): Promise<string> {
  if (explicit?.trim()) return explicit.trim();
  const stored = await getStoredOwnerPhone();
  if (stored) return stored;
  const sync = await ensureInboxOwnerPhone();
  return sync.phone ?? "";
}

/** Marca início da captura na primeira conexão bem-sucedida. */
export async function ensureInboxCaptureStarted(): Promise<void> {
  if (!prisma) return;
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (s?.inboxCaptureSince) return;
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { inboxCaptureSince: new Date() }
  });
}

/** Reinicia histórico local (ex.: novo QR / logout). */
export async function resetInboxCapture(clearMessages = true): Promise<void> {
  if (!prisma) return;
  const session = await getSessionName();
  if (clearMessages) {
    await prisma.inboxMessage.deleteMany({ where: { session } });
  }
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const map = parseInboxSessionState(settings?.inboxSessionState);
  delete map[session.trim().toLowerCase()];
  const active = (settings?.wppSession ?? "").trim().toLowerCase();
  await prisma.appSettings.update({
    where: { id: "default" },
    data: {
      inboxSessionState: map,
      ...(active === session.trim().toLowerCase()
        ? {
            inboxCaptureSince: new Date(),
            inboxOwnerPhone: null
          }
        : {})
    }
  });
  const { clearWaLidMap } = await import("./waLidMap.js");
  await clearWaLidMap(session);
}

/** Remove mensagens locais de uma instância excluída do painel. */
export async function resetInboxForSession(sessionName: string): Promise<void> {
  if (!prisma) return;
  const session = sessionName.trim().toLowerCase();
  if (!session) return;
  await prisma.inboxMessage.deleteMany({ where: { session } });
  const { purgeAiForSession } = await import("./ai/purge.js");
  await purgeAiForSession(session);
}

function extractMediaUrl(body: Record<string, unknown>): string | null {
  for (const key of ["fileUrl", "mediaUrl"] as const) {
    const v = body[key];
    if (typeof v === "string" && isPersistedUploadUrl(v)) return v;
  }
  // URLs do WhatsApp (clientUrl etc.) são criptografadas — não funcionam no navegador.
  const raw = body.body;
  const type = String(body.type ?? "chat");
  const mime = String(body.mimetype ?? body.mimeType ?? mimeFromMessageType(type));
  if (typeof raw === "string" && isLikelyBase64Payload(raw)) {
    if (raw.startsWith("data:")) return raw;
    return `data:${mime};base64,${raw.replace(/\s/g, "")}`;
  }
  return null;
}

async function resolveStoredMedia(
  type: string,
  text: string,
  mediaUrl: string | null | undefined
): Promise<{ body: string; mediaUrl: string | null }> {
  let url = mediaUrl ?? null;
  const rawText = text.trim();

  if (!url && isLikelyBase64Payload(rawText)) {
    try {
      url = await persistInboundMedia(rawText, mimeFromMessageType(type));
    } catch {
      url = rawText.startsWith("data:")
        ? rawText
        : `data:${mimeFromMessageType(type)};base64,${rawText.replace(/\s/g, "")}`;
    }
  } else if (url && url.startsWith("data:")) {
    try {
      url = await persistInboundMedia(url, mimeFromMessageType(type));
    } catch {
      /* mantém data URI */
    }
  }

  const body = captionFromText(type, rawText);
  return { body, mediaUrl: toPublicMediaUrl(url) ?? url };
}

const SKIP_INBOUND_TYPES = new Set([
  "e2e_notification",
  "notification",
  "notification_template",
  "protocol",
  "gp2",
  "call_log",
  "revoked",
  "ciphertext"
]);

function pickWaId(value: unknown): string {
  const id = extractWaId(value);
  if (!id || id.includes("status@broadcast")) return "";
  return id;
}

/** Prefere @c.us / @g.us em vez de @lid opaco (mensagens não batiam com a lista de chats). */
function pickCanonicalChatId(candidates: string[]): string {
  const valid = [...new Set(candidates.filter(Boolean))];
  if (valid.length === 0) return "";

  const rank = (id: string) => {
    if (id.endsWith("@g.us") || id.includes("@newsletter")) return 5;
    if (id.endsWith("@c.us") || id.endsWith("@s.whatsapp.net")) return 4;
    if (id.endsWith("@lid")) return 2;
    return 1;
  };

  valid.sort((a, b) => rank(b) - rank(a));
  return valid[0];
}

function peerChatIdFromWebhook(
  body: Record<string, unknown>,
  fromMe: boolean
): string {
  const sender = body.sender as Record<string, unknown> | undefined;
  const chat = body.chat as Record<string, unknown> | undefined;

  const ids: string[] = [
    pickWaId(body.chatId),
    pickWaId(chat?.id),
    pickWaId(body.remoteJid),
    pickWaId(body.from),
    pickWaId(body.to),
    pickWaId(body.author),
    pickWaId(sender?.id)
  ];

  if (fromMe) {
    return pickCanonicalChatId([
      pickWaId(body.to),
      pickWaId(body.chatId),
      pickWaId(chat?.id),
      pickWaId(body.from),
      pickWaId(body.author),
      pickWaId(body.remoteJid),
      pickWaId(sender?.id),
      ...ids
    ]);
  }

  return pickCanonicalChatId([
    pickWaId(body.chatId),
    pickWaId(chat?.id),
    pickWaId(body.from),
    pickWaId(body.author),
    pickWaId(body.remoteJid),
    pickWaId(sender?.id),
    pickWaId(body.to),
    ...ids
  ]);
}

const MEDIA_MESSAGE_TYPES = new Set([
  "image",
  "sticker",
  "video",
  "audio",
  "ptt",
  "document",
  "location"
]);

function isMediaMessageType(type: string): boolean {
  return MEDIA_MESSAGE_TYPES.has(type.toLowerCase());
}

/** Body genérico de mídia sem legenda — NÃO usar para colapsar msgs distintas. */
function isGenericMediaLabel(body: string): boolean {
  return /^(📷\s*Imagem|🎬\s*Vídeo|🎤\s*Áudio|📎\s*Documento|📍\s*Localização)$/i.test(
    body.replace(/^\uFEFF/, "").trim()
  );
}

function inboxMessageDedupeKey(row: {
  waMessageId: string | null;
  fromMe: boolean;
  body: string;
  timestamp: Date;
  chatId: string;
  type?: string;
}): string {
  if (row.waMessageId) return `wa:${row.waMessageId}`;
  const sec = Math.floor(row.timestamp.getTime() / 1000);
  return `${row.fromMe ? 1 : 0}|${row.type ?? "chat"}|${row.body}|${sec}|${row.chatId}`;
}

async function findDuplicateInboxMessage(params: {
  session: string;
  ownerPhone: string;
  chatId: string;
  body: string;
  fromMe: boolean;
  type: string;
  waMessageId: string | null;
  timestamp: Date;
}): Promise<{
  id: string;
  waMessageId: string | null;
  body: string;
  type: string;
  mediaUrl: string | null;
  timestamp: Date;
  createdAt: Date;
} | null> {
  if (!prisma) return null;

  if (params.waMessageId) {
    const byWaId = await prisma.inboxMessage.findFirst({
      where: { session: params.session, waMessageId: params.waMessageId },
      select: {
        id: true,
        waMessageId: true,
        body: true,
        type: true,
        mediaUrl: true,
        timestamp: true,
        createdAt: true
      }
    });
    if (byWaId) return byWaId;
  }

  const variants = await resolveAllChatIdsForContact(params.session, params.chatId);
  const windowStart = new Date(params.timestamp.getTime() - 120_000);
  const windowEnd = new Date(params.timestamp.getTime() + 45_000);
  const phoneDigits = digitsOnly(params.chatId);

  const chatIdFilter =
    phoneDigits.length >= 10
      ? {
          OR: [{ chatId: { in: variants } }, { chatId: { startsWith: phoneDigits } }]
        }
      : { chatId: { in: variants } };

  const selectDup = {
    id: true,
    waMessageId: true,
    body: true,
    type: true,
    mediaUrl: true,
    timestamp: true,
    createdAt: true
  } as const;

  // Mídia (áudio, imagem…) costuma repetir no webhook — deduplica por tipo + janela
  // só quando NÃO temos waMessageId (reentrega sem id). Com id distinto = msg distinta
  // (dois áudios em sequência não podem colapsar).
  if (isMediaMessageType(params.type)) {
    if (params.waMessageId) {
      return null;
    }

    // Sem waMessageId: áudio/ptt e labels genéricos nunca colapsam por janela.
    const mediaKind = params.type.toLowerCase();
    if (
      mediaKind === "audio" ||
      mediaKind === "ptt" ||
      isGenericMediaLabel(params.body)
    ) {
      return null;
    }

    const byWindow = await prisma.inboxMessage.findFirst({
      where: {
        session: params.session,
        ...chatIdFilter,
        fromMe: params.fromMe,
        type: params.type,
        timestamp: { gte: windowStart, lte: windowEnd }
      },
      orderBy: { timestamp: "desc" },
      select: selectDup
    });
    if (byWindow) return byWindow;

    // Mesma legenda/caption com IDs WA diferentes (sync com Date.now vs webhook real).
    // Só com legenda real — "🎤 Áudio" / "📷 Imagem" não contam (senão some áudio no inbox).
    const caption = params.body.trim();
    if (
      caption.length >= 8 &&
      !caption.startsWith("data:") &&
      !isGenericMediaLabel(caption)
    ) {
      const captionStart = new Date(params.timestamp.getTime() - 2 * 60 * 60_000);
      const captionEnd = new Date(params.timestamp.getTime() + 2 * 60 * 60_000);
      return prisma.inboxMessage.findFirst({
        where: {
          session: params.session,
          ...chatIdFilter,
          fromMe: params.fromMe,
          type: params.type,
          body: caption,
          timestamp: { gte: captionStart, lte: captionEnd }
        },
        orderBy: { timestamp: "desc" },
        select: selectDup
      });
    }
    return null;
  }

  // Eco da Evolution: fromMe webhook com mesmo texto de um reply AI/flow recente.
  if (params.fromMe) {
    const text = params.body.trim();
    if (text.length >= 8) {
      const echo = await prisma.inboxMessage.findFirst({
        where: {
          session: params.session,
          ...chatIdFilter,
          fromMe: true,
          source: { in: ["ai", "flow"] },
          body: text,
          timestamp: { gte: windowStart, lte: windowEnd }
        },
        orderBy: { timestamp: "desc" },
        select: selectDup
      });
      if (echo) return echo;
    }
  }

  return prisma.inboxMessage.findFirst({
    where: {
      session: params.session,
      ...chatIdFilter,
      fromMe: params.fromMe,
      type: params.type,
      body: params.body,
      timestamp: { gte: windowStart, lte: windowEnd }
    },
    orderBy: { timestamp: "desc" },
    select: selectDup
  });
}

export type SaveInboxMessageResult = {
  id: string;
  session: string;
  chatId: string;
  fromMe: boolean;
  source: InboxMessageSource;
  type: string;
  body: string;
  waMessageId: string | null;
};

export async function saveInboxMessage(params: {
  chatId: string;
  body: string;
  fromMe: boolean;
  source?: InboxMessageSource;
  type?: string;
  mediaUrl?: string | null;
  waMessageId?: string | null;
  timestamp?: Date;
  sessionName?: string;
  ownerPhone?: string | null;
  peerJids?: string[];
}): Promise<SaveInboxMessageResult | null> {
  if (!prisma) return null;

  const session = (params.sessionName ?? (await getSessionName())).trim().toLowerCase();
  const ownerPhone = await resolveOwnerPhoneForSave(session, params.ownerPhone);
  const rawChatId = normalizeDirectJid(extractWaId(params.chatId) || params.chatId.trim());
  if (!rawChatId || rawChatId.includes("status@broadcast")) return null;
  const chatId = await canonicalizeChatId(session, rawChatId, params.peerJids ?? []);

  const type = params.type ?? "chat";
  const source: InboxMessageSource = params.source ?? "webhook";
  const { body, mediaUrl } = await resolveStoredMedia(type, params.body, params.mediaUrl);
  const waMessageId = params.waMessageId?.slice(0, 240) ?? null;
  const timestamp = params.timestamp ?? new Date();

  const duplicate = await findDuplicateInboxMessage({
    session,
    ownerPhone,
    chatId,
    body,
    fromMe: params.fromMe,
    type,
    waMessageId,
    timestamp
  });
  if (duplicate) {
    const patch: {
      waMessageId?: string;
      body?: string;
      type?: string;
      mediaUrl?: string | null;
      timestamp?: Date;
    } = {};
    if (waMessageId && !duplicate.waMessageId) {
      patch.waMessageId = waMessageId;
    }
    // Placeholder de template/botão → sobrescreve quando o sync finalmente traz o texto real.
    if (
      body.trim() &&
      !isButtonPlaceholderBody(body) &&
      isButtonPlaceholderBody(String(duplicate.body ?? ""))
    ) {
      patch.body = body;
      patch.type = type;
    }
    if (mediaUrl && !duplicate.mediaUrl) {
      patch.mediaUrl = mediaUrl;
    }
    const incomingType = type === "ptt" ? "audio" : type;
    const storedType = duplicate.type === "ptt" ? "audio" : duplicate.type;
    if (
      (incomingType === "image" || incomingType === "video" || incomingType === "audio" || incomingType === "sticker") &&
      (storedType === "document" || storedType === "chat")
    ) {
      patch.type = incomingType;
      if (mediaUrl) patch.mediaUrl = mediaUrl;
    }
    // Corrige horário inventado (Date.now no sync) quando chega o timestamp real do WA.
    const newTs = timestamp.getTime();
    const storedTs = duplicate.timestamp.getTime();
    const newLooksReal = Math.abs(newTs - Date.now()) > 90_000;
    const storedLooksFake =
      Math.abs(storedTs - duplicate.createdAt.getTime()) < 120_000 ||
      Math.abs(storedTs - Date.now()) < 120_000;
    if (newLooksReal && storedLooksFake && Math.abs(newTs - storedTs) > 60_000) {
      patch.timestamp = timestamp;
    }
    if (Object.keys(patch).length > 0) {
      await prisma.inboxMessage.update({
        where: { id: duplicate.id },
        data: patch
      });
    }
    return null;
  }

  await recordWaJidMapping(session, chatId, ...(params.peerJids ?? []), params.chatId).catch(
    () => {}
  );

  try {
    const created = await prisma.inboxMessage.create({
      data: {
        session,
        ownerPhone,
        chatId,
        body,
        fromMe: params.fromMe,
        source,
        type,
        mediaUrl,
        waMessageId,
        timestamp
      }
    });

    const saved: SaveInboxMessageResult = {
      id: created.id,
      session,
      chatId,
      fromMe: params.fromMe,
      source,
      type,
      body,
      waMessageId
    };

    if (!params.fromMe) {
      // Em grupo, o "telefone" do peer é de um participante — reexibir por ele
      // ressuscitava a conversa privada apagada dessa pessoa. Grupo reexibe a si.
      // Sempre passa chatId: pickPhoneJid pode falhar em @lid puro e o unhide
      // precisa limpar as chaves id:… gravadas no "Apagar conversa".
      const unhidePhone = isGroupLikeJid(chatId)
        ? chatId
        : pickPhoneJid([chatId, ...(params.peerJids ?? []), params.chatId]) ?? chatId;
      await unhideContactFromInbox(session, unhidePhone, chatId).catch(() => {});
      await unarchiveContactFromInbox(session, unhidePhone, chatId).catch(() => {});
    }

    const { enqueueAiPipeline } = await import("./ai/enqueue.js");
    enqueueAiPipeline(saved);

    if (!params.fromMe && !isGroupLikeJid(chatId)) {
      const phone = chatId.replace(/@.*/, "").replace(/\D/g, "");
      void import("./contactStage.js")
        .then((m) => m.noteInbound(phone))
        .catch(() => {});
    }

    return saved;
  } catch (err) {
    if (isPrismaUniqueConflict(err) && waMessageId) return null;
    throw err;
  }
}

export async function updateInboxMessageMedia(
  waMessageId: string,
  mediaUrl: string
): Promise<void> {
  if (!prisma || !waMessageId) return;
  const session = await getSessionName();
  const publicUrl = toPublicMediaUrl(mediaUrl) ?? mediaUrl;
  await prisma.inboxMessage.updateMany({
    where: { session, waMessageId: waMessageId.slice(0, 240) },
    data: { mediaUrl: publicUrl }
  });
}

/** Mídia já veio no webhook (base64/data URI) — não precisa baixar de novo. */
export function webhookMediaAlreadyInline(
  parsed: { mediaUrl: string | null; text: string; type: string }
): boolean {
  if (isPersistedUploadUrl(parsed.mediaUrl)) return true;
  if (parsed.mediaUrl?.startsWith("data:")) return true;
  if (isLikelyBase64Payload(parsed.text)) return true;
  return false;
}

/** Conversas já capturadas via webhook (fallback quando a API não lista chats). */
export async function listStoredChatSummaries(): Promise<NormalizedChat[]> {
  if (!prisma) return [];
  const session = await getSessionName();
  await loadWaLidMap(session);

  const distinct = await prisma.inboxMessage.findMany({
    where: { session },
    select: { chatId: true },
    distinct: ["chatId"]
  });

  const groupIds = new Map<string, Set<string>>();
  const primaryByKey = new Map<string, string>();

  for (const { chatId: rawId } of distinct) {
    const variants = await resolveAllChatIdsForContact(session, rawId);
    const primary = preferPrimaryChatId(variants) || rawId;
    const isGroup = isGroupLikeJid(primary);
    const phoneDigits = digitsOnly(primary.replace(/@.*/, "")) || primary.replace(/@.*/, "");
    const mapKey =
      !isGroup && isValidWhatsAppPhoneDigits(phoneDigits)
        ? `p:${phoneDedupeKey(phoneDigits)}`
        : `id:${primary}`;

    const set = groupIds.get(mapKey) ?? new Set<string>();
    for (const v of variants) set.add(v);
    groupIds.set(mapKey, set);
    if (!primaryByKey.has(mapKey)) primaryByKey.set(mapKey, primary);
  }

  const merged: NormalizedChat[] = [];
  for (const [mapKey, ids] of groupIds) {
    const idList = [...ids];
    if (idList.length === 0) continue;

    const latest = await prisma.inboxMessage.findFirst({
      where: { session, chatId: { in: idList } },
      orderBy: { timestamp: "desc" },
      select: { body: true, timestamp: true, fromMe: true }
    });
    if (!latest) continue;

    const primary = primaryByKey.get(mapKey) ?? idList[0];
    if (isStatusBroadcastJid(primary)) continue;
    const isGroup = isGroupLikeJid(primary);
    const phoneDigits = digitsOnly(primary.replace(/@.*/, "")) || primary.replace(/@.*/, "");

    merged.push({
      id: primary,
      phone: isGroup ? "" : phoneDigits,
      name: isGroup ? "" : phoneDigits,
      lastMessage: latest.body.slice(0, 120),
      timestamp: latest.timestamp.getTime(),
      isGroup,
      kind: primary.includes("@newsletter")
        ? ("community" as const)
        : isGroup
          ? ("group" as const)
          : ("direct" as const),
      // 1 = há inbound recente sem "lido" local — reabre card após "Apagar conversa".
      unreadCount: latest.fromMe ? 0 : 1,
      lastFromMe: latest.fromMe
    });
  }

  return merged;
}

/** Contato enviou alguma mensagem recebida (fromMe=false) no inbox. */
export async function contactHasInboundReply(params: {
  phone: string;
  since?: Date;
}): Promise<boolean> {
  if (!prisma) return false;

  const session = await getSessionName();
  await loadWaLidMap(session);

  const chatIds = new Set<string>();
  for (const key of expandPhoneLookupKeys(params.phone)) {
    if (key.includes("@")) {
      chatIds.add(normalizeDirectJid(key));
    } else if (key.length >= 10) {
      chatIds.add(`${key}@s.whatsapp.net`);
      chatIds.add(`${key}@c.us`);
      chatIds.add(`${key}@lid`);
    }
  }

  const allVariants: string[] = [];
  for (const id of chatIds) {
    const expanded = await resolveAllChatIdsForContact(session, id);
    for (const v of expanded) allVariants.push(v);
  }
  const unique = [...new Set(allVariants)];
  if (unique.length === 0) return false;

  const row = await prisma.inboxMessage.findFirst({
    where: {
      session,
      chatId: { in: unique },
      fromMe: false,
      ...(params.since ? { timestamp: { gte: params.since } } : {})
    },
    select: { id: true }
  });
  return Boolean(row);
}

export async function listStoredMessages(
  chatId: string,
  limit = 200,
  sessionName?: string
): Promise<{ messages: NormalizedMessage[]; captureSince: string | null }> {
  if (!prisma) {
    return { messages: [], captureSince: null };
  }

  const session = (sessionName ?? (await getSessionName())).trim().toLowerCase();
  const variants = await resolveAllChatIdsForContact(session, chatId);

  const rows = await prisma.inboxMessage.findMany({
    where: {
      session,
      chatId: { in: variants }
    },
    orderBy: { timestamp: "desc" },
    take: limit
  });
  rows.reverse();

  const seen = new Set<string>();
  const kept: typeof rows = [];
  for (const r of rows) {
    const key = inboxMessageDedupeKey(r);
    if (seen.has(key)) continue;
    seen.add(key);

    // Colapsa o mesmo vídeo/imagem com LEGENDA idêntica gravado 2x (IDs WA diferentes).
    // Nunca colapsar áudio/imagem sem legenda ("🎤 Áudio") — senão N áudios viram 1 no painel
    // enquanto a IA ainda responde a cada um.
    if (
      isMediaMessageType(r.type) &&
      r.body.trim().length >= 8 &&
      !r.body.startsWith("data:") &&
      !isGenericMediaLabel(r.body)
    ) {
      const twin = kept.find(
        (k) =>
          k.fromMe === r.fromMe &&
          k.type === r.type &&
          k.body.trim() === r.body.trim() &&
          Math.abs(k.timestamp.getTime() - r.timestamp.getTime()) <= 2 * 60 * 60_000
      );
      if (twin) {
        // Prefere a cópia com mídia baixada / waMessageId / horário mais antigo.
        const twinScore = (twin.mediaUrl ? 2 : 0) + (twin.waMessageId ? 1 : 0);
        const rowScore = (r.mediaUrl ? 2 : 0) + (r.waMessageId ? 1 : 0);
        if (rowScore > twinScore || (rowScore === twinScore && r.timestamp < twin.timestamp)) {
          const idx = kept.indexOf(twin);
          kept[idx] = r;
        }
        continue;
      }
    } else if (!r.waMessageId) {
      const sec = Math.floor(r.timestamp.getTime() / 1000);
      const contentKey =
        r.fromMe && r.type === "chat"
          ? `${r.fromMe ? 1 : 0}|${r.type}|${r.body}|${sec}`
          : `${r.fromMe ? 1 : 0}|${r.type}|${r.body}|${sec}|${r.chatId}|${r.id}`;
      if (seen.has(`content:${contentKey}`)) continue;
      seen.add(`content:${contentKey}`);
    }

    kept.push(r);
  }

  const dedupedRows = kept;

  dedupedRows.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const { isInboundMediaType, downloadMediaForStoredMessage } = await import("./wppMedia.js");
  const hydrateCandidates = dedupedRows
    .filter(
      (r) =>
        !isGroupLikeJid(r.chatId) &&
        !r.mediaUrl &&
        r.waMessageId &&
        isInboundMediaType(r.type === "ptt" ? "audio" : r.type)
    )
    .slice(-8);
  const hydratedUrls = new Map<string, string>();

  for (const r of hydrateCandidates) {
    try {
      const downloaded = await downloadMediaForStoredMessage({
        chatId: r.chatId,
        waMessageId: r.waMessageId!,
        type: r.type === "ptt" ? "audio" : r.type
      });
      if (downloaded) {
        const publicUrl = toPublicMediaUrl(downloaded) ?? downloaded;
        hydratedUrls.set(r.id, publicUrl);
        await updateInboxMessageMedia(r.waMessageId!, downloaded);
      }
    } catch {
      /* mídia indisponível */
    }
  }

  const messages: NormalizedMessage[] = [];
  for (const r of dedupedRows) {
    let body = r.body;
    let mediaUrl = toPublicMediaUrl(r.mediaUrl) ?? r.mediaUrl;
    const normalizedType = r.type === "ptt" ? "audio" : r.type;

    if (!mediaUrl && hydratedUrls.has(r.id)) {
      mediaUrl = hydratedUrls.get(r.id) ?? null;
    }

    if (!mediaUrl && isLikelyBase64Payload(body)) {
      mediaUrl =
        body.startsWith("data:")
          ? body
          : `data:${mimeFromMessageType(normalizedType)};base64,${body.replace(/\s/g, "")}`;
      body = labelForMediaType(normalizedType) || "Mídia";
    } else if (isLikelyBase64Payload(body)) {
      body = labelForMediaType(r.type) || body.slice(0, 40);
    }
    messages.push({
      id: r.id,
      body,
      fromMe: r.fromMe,
      timestamp: r.timestamp.getTime(),
      type: normalizedType,
      mediaUrl
    });
  }

  return {
    messages,
    captureSince: null
  };
}

export function parseWppWebhookMessage(body: Record<string, unknown>): {
  chatId: string;
  text: string;
  fromMe: boolean;
  type: string;
  mediaUrl: string | null;
  waMessageId: string | null;
  timestamp: Date;
} | null {
  const ev = String(body.event ?? "").toLowerCase();
  if (ev && /^(on)?ack$|presence|statechange|revoked|reaction|poll|status/.test(ev)) {
    return null;
  }

  const fromMe = body.fromMe === true || body.fromMe === "true";
  const type = String(body.type ?? "chat").toLowerCase();

  if (SKIP_INBOUND_TYPES.has(type)) {
    const hasText =
      body.body !== undefined ||
      body.content !== undefined ||
      body.caption !== undefined ||
      body.isMedia === true ||
      body.isMMS === true;
    if (!hasText) return null;
  }

  const chatId = peerChatIdFromWebhook(body, fromMe);
  if (!chatId) return null;

  const text = String(
    body.body ?? body.content ?? body.caption ?? body.text ?? ""
  );

  let waMessageId: string | null = null;
  const idField = body.id;
  if (typeof idField === "string") waMessageId = idField;
  else if (idField && typeof idField === "object") {
    const o = idField as Record<string, unknown>;
    waMessageId = String(o._serialized ?? o.id ?? "");
  }

  let ts = Date.now();
  if (typeof body.timestamp === "number") {
    ts = body.timestamp > 1e12 ? body.timestamp : body.timestamp * 1000;
  } else if (typeof body.t === "number") {
    ts = body.t > 1e12 ? body.t : body.t * 1000;
  }

  const mediaUrl = extractMediaUrl(body);

  return {
    chatId,
    text,
    fromMe,
    type,
    mediaUrl,
    waMessageId: waMessageId || null,
    timestamp: new Date(ts)
  };
}

/** Apaga todas as mensagens locais de uma conversa (todos os chatId variantes). */
export async function deleteInboxConversation(chatId: string): Promise<number> {
  if (!prisma) return 0;
  const session = await getSessionName();
  const variants = await resolveAllChatIdsForContact(session, chatId);
  const result = await prisma.inboxMessage.deleteMany({
    where: { session, chatId: { in: variants } }
  });
  // A lista de conversas vem do provedor (Evolution), não do banco. Só apagar as
  // mensagens não some com a conversa — ela reaparece na próxima atualização.
  // Por isso ocultamos também. Volta sozinha se a pessoa mandar nova mensagem
  // (o recebimento faz unhide).
  const phone = digitsOnly(chatId.replace(/@.*/, ""));
  await hideContactFromInbox(session, phone, chatId).catch(() => {});
  return result.count;
}

/** Remove contato do CRM: mensagens, registro, tags e memória IA. */
export async function removeContactFromCrm(
  phone: string,
  chatIdHint?: string
): Promise<{
  messagesDeleted: number;
  contactDeleted: boolean;
}> {
  if (!prisma) return { messagesDeleted: 0, contactDeleted: false };

  const session = await getSessionName();
  const { findContactByPhoneLoose } = await import("./contacts.js");
  const { purgeAiForContact } = await import("./ai/purge.js");

  const seed =
    chatIdHint?.trim() ||
    (phone.includes("@") ? phone : `${phone.replace(/\D/g, "")}@s.whatsapp.net`);
  const canonical = await findPrimaryChatIdForContact(session, seed);
  const variants = await resolveAllChatIdsForContact(session, canonical);

  const deleted = await prisma.inboxMessage.deleteMany({
    where: { session, chatId: { in: variants } }
  });

  await purgeAiForContact(session, variants);

  const contact = await findContactByPhoneLoose(phone);
  if (contact) {
    await prisma.contact.delete({ where: { id: contact.id } });
  }

  await hideContactFromInbox(session, phone || canonical, canonical);

  return { messagesDeleted: deleted.count, contactDeleted: Boolean(contact) };
}
