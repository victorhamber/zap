import * as wpp from "./whatsapp/index.js";
import { listStoredMessages, saveInboxMessage } from "./inboxStore.js";
import { prisma } from "../prisma.js";
import { buildWppSendTarget, sendWppApi, sendWppText, extractWppMessageId } from "./wppSend.js";
import { convertWebmDataUrlToOgg } from "./mediaConvert.js";
import {
  canonicalEvolutionChatId,
  digitsOnly,
  isGenericSelfChatName,
  isGroupLikeJid,
  isStatusBroadcastJid,
  isLikelyInternalLidJid,
  isOwnerPhoneDigits,
  isValidWhatsAppPhoneDigits,
  normalizeDirectJid
} from "./waJid.js";
import { canonicalBrazilPhone, expandPhoneLookupKeys, phoneDedupeKey } from "../utils/phone.js";
import {
  expandChatIdVariants,
  extractEvolutionKeyFields,
  getMappedPhoneJid,
  loadWaLidMap,
  recordWaJidMapping,
  recordWaJidMappingSync,
  flushWaLidMap
} from "./waLidMap.js";
import {
  getUploadFileSize,
  MEDIA_SEND_URL_THRESHOLD_BYTES,
  readUploadFileBase64,
  rewriteUploadUrlForWpp,
  saveUploadFromData,
  toPublicMediaUrl,
  uploadFilenameFromUrl,
  WHATSAPP_INLINE_VIDEO_MAX_BYTES
} from "./uploads.js";

/** Suprime badge de não lidas após abrir a conversa no painel. */
const readChatUntil = new Map<string, number>();

function readChatKey(session: string, chatId: string): string {
  return `${session.trim().toLowerCase()}|${normalizeDirectJid(chatId)}`;
}

export function markChatReadLocally(session: string, chatId: string, ttlMs = 600_000): void {
  readChatUntil.set(readChatKey(session, chatId), Date.now() + ttlMs);
}

export function isChatReadLocally(session: string, chatId: string): boolean {
  const until = readChatUntil.get(readChatKey(session, chatId));
  return typeof until === "number" && until > Date.now();
}

export async function markInboxChatAsRead(chatId: string, isGroup = false): Promise<void> {
  const session = await wpp.getActiveWppSessionName();
  await loadWaLidMap(session);
  markChatReadLocally(session, chatId);

  const mapped = getMappedPhoneJid(session, chatId);
  const resolvedId = mapped ?? normalizeDirectJid(chatId);
  const { prisma } = await import("../prisma.js");
  if (!prisma) return;

  const variants = await expandChatIdVariants(session, resolvedId);
  const rows = await prisma.inboxMessage.findMany({
    where: {
      session,
      chatId: { in: variants },
      fromMe: false,
      waMessageId: { not: null }
    },
    orderBy: { timestamp: "desc" },
    take: 20,
    select: { waMessageId: true, chatId: true }
  });

  const payload = rows
    .filter((r) => r.waMessageId)
    .map((r) => ({
      id: r.waMessageId!,
      remoteJid: r.chatId,
      fromMe: false
    }));

  if (payload.length === 0 && !isGroup) return;

  const { markChatAsRead } = await import("./waha.js");
  await markChatAsRead(resolvedId);
}

export type ChatKind = "direct" | "group" | "community";

export type NormalizedChat = {
  id: string;
  phone: string;
  name: string;
  lastMessage: string;
  timestamp: number;
  isGroup: boolean;
  kind: ChatKind;
  unreadCount: number;
  /** true quando a última mensagem da conversa foi enviada por este número. */
  lastFromMe: boolean;
};

export type NormalizedMessage = {
  id: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  type: string;
  mediaUrl?: string | null;
};

export type FetchMessagesOptions = {
  chatId: string;
  isGroup?: boolean;
  count?: number;
  /**
   * true = lê só do banco, sem chamar a Evolution. O webhook mantém o banco
   * atualizado em tempo real, então o poll rápido do painel usa isto para não
   * disparar sync externo a cada 2,5s (era a causa da lentidão).
   */
  skipSync?: boolean;
};

/** Extrai ID serializado do WhatsApp (ex.: 120363…@g.us) quando o WPP devolve objeto Wid. */
export function extractWaId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (!s || s === "undefined" || s === "[object Object]") return "";
    return s;
  }
  if (typeof value !== "object") return "";

  const o = value as Record<string, unknown>;
  if (typeof o._serialized === "string") return extractWaId(o._serialized);
  if (typeof o.id === "string" || (o.id && typeof o.id === "object")) {
    const nested = extractWaId(o.id);
    if (nested) return nested;
  }
  const user = o.user ?? o.userid;
  const server = o.server;
  if (user != null && server != null) {
    return `${String(user).replace(/\D/g, "") || String(user)}@${String(server)}`;
  }
  return "";
}

function isValidWaId(id: string): boolean {
  return (
    Boolean(id) &&
    !id.includes("[object Object]") &&
    /^[a-zA-Z0-9._+-]+@[a-z0-9.]+$/i.test(id)
  );
}

function chatIdToPhone(id: string): string {
  const base = id.replace(/@.*/, "");
  const digits = digitsOnly(base) || base;
  return isValidWhatsAppPhoneDigits(digitsOnly(digits)) ? canonicalBrazilPhone(digits) : digits;
}

function isPhoneLikeText(text: string): boolean {
  const d = digitsOnly(text);
  return d.length >= 10 && d.length <= 15 && /^\d+$/.test(d);
}

function resolveChatId(chatId: string, isGroup?: boolean): string {
  const raw = extractWaId(chatId) || chatId.trim();
  if (raw.includes("@")) return normalizeDirectJid(raw);
  const clean = digitsOnly(chatId);
  if (!clean) return chatId;
  if (isGroup) return `${clean}@g.us`;
  return `${clean}@s.whatsapp.net`;
}

function detectKind(id: string, o?: Record<string, unknown>): ChatKind {
  // O JID manda: grupo é sempre @g.us, comunidade/canal @newsletter.
  if (id.includes("@newsletter")) return "community";
  if (id.includes("@g.us")) return "group";
  // Id baseado em telefone é SEMPRE conversa direta — ignore flags do provedor.
  // A Evolution às vezes marca isGroup=true num contato direto, e ele aparecia
  // no painel como "Grupos". Grupo real nunca tem id de telefone.
  const phone = digitsOnly(id.replace(/@.*/, ""));
  if (isValidWhatsAppPhoneDigits(phone)) return "direct";
  if (o?.isCommunity === true) return "community";
  if (o?.isGroup === true) return "group";
  return "direct";
}

/** Evita `[object Object]` quando a Evolution manda nome/subject como objeto. */
function coerceDisplayText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const t = value.trim();
    return t === "[object Object]" ? "" : t;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const key of [
      "subject",
      "name",
      "formattedTitle",
      "pushName",
      "notify",
      "verifiedName",
      "text",
      "title",
      "displayName",
      "communityName",
      "groupName"
    ]) {
      const nested = coerceDisplayText(o[key]);
      if (nested) return nested;
    }
  }
  return "";
}

function pickChatDisplayName(o: Record<string, unknown>, ...extras: unknown[]): string {
  const contactObj =
    o.contact && typeof o.contact === "object" ? (o.contact as Record<string, unknown>) : null;
  const candidates: unknown[] = [
    o.pushName,
    o.name,
    o.formattedTitle,
    o.subject,
    o.notify,
    o.verifiedName,
    o.communityName,
    o.groupName,
    contactObj?.name,
    contactObj?.pushname,
    contactObj?.subject,
    o.pushname,
    o.shortName,
    ...extras
  ];
  for (const c of candidates) {
    const text = coerceDisplayText(c);
    if (text) return text;
  }
  return "";
}

/**
 * Nome de grupo/canal só pode vir do assunto do próprio grupo.
 * `pushName`/`notify` são do REMETENTE da última mensagem — usá-los batizava o
 * grupo com o nome de um participante (mensagens "com o nome trocado").
 */
function pickGroupDisplayName(o: Record<string, unknown>): string {
  const contactObj =
    o.contact && typeof o.contact === "object" ? (o.contact as Record<string, unknown>) : null;
  const groupMeta =
    o.groupMetadata && typeof o.groupMetadata === "object"
      ? (o.groupMetadata as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [
    o.subject,
    groupMeta?.subject,
    o.groupName,
    o.communityName,
    o.formattedTitle,
    o.name,
    contactObj?.subject,
    contactObj?.name
  ];
  for (const c of candidates) {
    const text = coerceDisplayText(c);
    if (text) return text;
  }
  return "";
}

/** Texto da última mensagem no formato Evolution API (Baileys). */
function evolutionLastPreview(lastMsg: Record<string, unknown>): string {
  const inner =
    lastMsg.message && typeof lastMsg.message === "object"
      ? (lastMsg.message as Record<string, unknown>)
      : null;
  if (inner) {
    if (typeof inner.conversation === "string" && inner.conversation.trim()) {
      return inner.conversation.trim();
    }
    const ext = inner.extendedTextMessage as Record<string, unknown> | undefined;
    if (ext && typeof ext.text === "string" && ext.text.trim()) return ext.text.trim();
    if (inner.imageMessage) return "📷 Imagem";
    if (inner.videoMessage) return "🎬 Vídeo";
    if (inner.audioMessage || inner.pttMessage) return "🎤 Áudio";
    if (inner.documentMessage) return "📎 Documento";
    if (inner.stickerMessage) return "🎭 Sticker";
  }
  return messageBody(lastMsg);
}

function parseTimestamp(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
    }
    const parsed = Date.parse(t);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.low === "number") {
      const seconds = (typeof o.high === "number" ? o.high : 0) * 2 ** 32 + (o.low >>> 0);
      if (seconds > 0) return seconds > 1e12 ? seconds : seconds * 1000;
    }
  }
  return 0;
}

function parseChatItem(item: unknown, session?: string): NormalizedChat | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;

  const keyFields = extractEvolutionKeyFields(o);
  if (session) {
    recordWaJidMappingSync(
      session,
      keyFields.remoteJid,
      keyFields.remoteJidAlt,
      keyFields.participant,
      keyFields.participantAlt
    );
  }

  const peer = canonicalEvolutionChatId(keyFields, o);

  const rawId =
    extractWaId(peer) ||
    extractWaId(o.remoteJidAlt) ||
    extractWaId(o.remoteJidalt) ||
    extractWaId(o.remoteJid) ||
    extractWaId(o.jid) ||
    extractWaId(o.id) ||
    extractWaId(o.chatId) ||
    extractWaId(o._id) ||
    extractWaId(o.phone) ||
    String(o.phone ?? "").trim();
  if (!rawId || rawId === "undefined") return null;

  const kindHint = detectKind(rawId.includes("@") ? rawId : `${rawId}@c.us`, o);
  // NÃO usar `o.isGroup` aqui: detectKind já ignora a flag para ids de telefone,
  // então confiar nela de novo faria um contato direto virar `...@g.us` (grupo
  // falso). Só o kindHint decide o sufixo.
  let resolvedId = rawId.includes("@")
    ? normalizeDirectJid(rawId)
    : normalizeDirectJid(
        resolveChatId(rawId, kindHint === "group" || kindHint === "community")
      );
  if (!isValidWaId(resolvedId) || isStatusBroadcastJid(resolvedId)) return null;

  const kindEarly = detectKind(resolvedId, o);
  if (
    session &&
    kindEarly !== "group" &&
    kindEarly !== "community" &&
    isLikelyInternalLidJid(resolvedId)
  ) {
    const mapped = getMappedPhoneJid(session, resolvedId);
    if (mapped) resolvedId = mapped;
  }

  const isGroupChat = kindEarly === "group" || kindEarly === "community";
  const displayName = isGroupChat ? pickGroupDisplayName(o) : pickChatDisplayName(o);
  if (isLikelyInternalLidJid(resolvedId) && !displayName) return null;

  const phoneDigits = digitsOnly(resolvedId);
  // Grupo não tem telefone — o 120363… não pode vazar como número no painel.
  const phone = isGroupChat
    ? ""
    : isValidWhatsAppPhoneDigits(phoneDigits)
      ? phoneDigits
      : displayName
        ? ""
        : resolvedId.split("@")[0];
  const kind = detectKind(resolvedId, o);
  const lastMsg =
    o.lastMessage && typeof o.lastMessage === "object"
      ? (o.lastMessage as Record<string, unknown>)
      : o;
  // O pushName da última mensagem é do REMETENTE: só serve como nome do chat
  // em conversa direta recebida. Em grupo é um participante; se fromMe, é você.
  const lastMsgFromMe =
    (lastMsg.key as Record<string, unknown> | undefined)?.fromMe === true ||
    lastMsg.fromMe === true;
  const lastMsgPush =
    kind === "direct" && !lastMsgFromMe ? pickChatDisplayName(lastMsg) : "";
  let name =
    kind === "group" || kind === "community"
      ? pickGroupDisplayName(o)
      : pickChatDisplayName(o, lastMsgPush);
  if (!name && kind === "community") {
    name = `Comunidade ${resolvedId.split("@")[0]?.slice(-6) || ""}`.trim();
  }
  if (!name && kind === "group") {
    name = `Grupo ${resolvedId.split("@")[0]?.slice(-6) || ""}`.trim();
  }
  if (!name && kind === "direct") {
    name = phone || resolvedId.split("@")[0];
  }

  if (kind === "direct" && isGenericSelfChatName(name)) {
    const phoneDigits = digitsOnly(phone || resolvedId);
    name = isValidWhatsAppPhoneDigits(phoneDigits) ? phoneDigits : name;
  }

  const lastBody = evolutionLastPreview(lastMsg) || String(o.msg ?? o.preview ?? "");

  const ts = parseTimestamp(
    lastMsg?.messageTimestamp ??
      lastMsg?.timestamp ??
      lastMsg?.t ??
      o.conversationTimestamp ??
      o.t ??
      o.timestamp ??
      o.time
  );

  const isGroup = kind === "group" || kind === "community";

  let normalizedPhone = phone;
  if (kind === "direct" && phone && isValidWhatsAppPhoneDigits(digitsOnly(phone))) {
    normalizedPhone = canonicalBrazilPhone(phone);
  }
  if (kind === "direct" && isPhoneLikeText(name)) {
    name = canonicalBrazilPhone(name);
  }

  return {
    id: resolvedId,
    phone: normalizedPhone,
    name: name || normalizedPhone || "Contato",
    lastMessage: lastBody.slice(0, 120),
    timestamp: ts,
    isGroup,
    kind,
    unreadCount: Number(o.unreadCount ?? o.unread ?? 0) || 0,
    lastFromMe: lastMsgFromMe
  };
}

export function normalizeChats(raw: unknown, session?: string): NormalizedChat[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.response)) list = o.response;
    else if (Array.isArray(o.chats)) list = o.chats;
    else     if (Array.isArray(o.data)) list = o.data;
    else if (Array.isArray(o.records)) list = o.records;
    else if (o.response && typeof o.response === "object") {
      list = Object.values(o.response as Record<string, unknown>);
    }
  }

  return list.map((item) => parseChatItem(item, session)).filter((c): c is NormalizedChat => Boolean(c));
}

function messageBody(o: Record<string, unknown>): string {
  const type = String(o.type ?? "chat");
  const text = String(o.body ?? o.content ?? o.caption ?? o.text ?? "");
  if (text.trim()) return text;
  if (type === "image" || type === "sticker") return "📷 Imagem";
  if (type === "video") return "🎬 Vídeo";
  if (type === "audio" || type === "ptt") return "🎤 Áudio";
  if (type === "document") return "📎 Documento";
  if (type === "location") return "📍 Localização";
  return "";
}

function parseMessageItem(item: unknown): NormalizedMessage | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const body = messageBody(o);
  const id = String(o.id ?? o._id ?? `${o.timestamp ?? o.t ?? Date.now()}_${body.slice(0, 8)}`);
  const fromMe =
    o.fromMe === true ||
    o.fromMe === "true" ||
    (typeof o.ack === "string" && /fromme|sender/i.test(o.ack));
  return {
    id,
    body,
    fromMe,
    timestamp: parseTimestamp(o.timestamp ?? o.t ?? o.messageTimestamp),
    type: String(o.type ?? "chat")
  };
}

function extractMessageList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];

  const o = raw as Record<string, unknown>;
  const keys = ["response", "messages", "data", "items", "msgs"] as const;

  for (const key of keys) {
    const val = o[key];
    if (Array.isArray(val)) return val;
    if (val && typeof val === "object") {
      const nested = extractMessageList(val);
      if (nested.length > 0) return nested;
    }
  }

  if (o.response && typeof o.response === "object" && !Array.isArray(o.response)) {
    const resp = o.response as Record<string, unknown>;
    for (const v of Object.values(resp)) {
      if (Array.isArray(v)) return v;
    }
  }

  return [];
}

export function normalizeMessages(raw: unknown): NormalizedMessage[] {
  const list = extractMessageList(raw);
  return list
    .map(parseMessageItem)
    .filter((m): m is NormalizedMessage => Boolean(m))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function extractArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  for (const key of ["response", "chats", "data", "contacts", "groups", "records"]) {
    const val = o[key];
    if (Array.isArray(val)) return val;
  }
  if (o.response && typeof o.response === "object" && !Array.isArray(o.response)) {
    return Object.values(o.response as Record<string, unknown>);
  }
  return [];
}

/** Chave única por telefone real — evita duplicata @lid vs @s.whatsapp.net */
function chatDedupeKey(c: NormalizedChat, session?: string): string {
  if (c.isGroup || c.kind !== "direct") {
    const gid = digitsOnly(c.id) || c.id.replace(/@.*/, "");
    return `g:${gid}`;
  }
  const phoneKey = canonicalDirectPhoneDigits(c, session);
  if (phoneKey) return `p:${phoneKey}`;
  return `id:${c.id}`;
}

function canonicalDirectPhoneDigits(c: NormalizedChat, session?: string): string | null {
  if (c.isGroup || c.kind !== "direct") return null;
  if (session && isLikelyInternalLidJid(c.id)) {
    const mapped = getMappedPhoneJid(session, c.id);
    if (mapped) {
      const md = digitsOnly(mapped);
      if (isValidWhatsAppPhoneDigits(md)) return phoneDedupeKey(md);
    }
  }
  const d = digitsOnly(c.id);
  if (isValidWhatsAppPhoneDigits(d)) return phoneDedupeKey(d);
  const phoneDigits = digitsOnly(c.phone);
  if (isValidWhatsAppPhoneDigits(phoneDigits)) return phoneDedupeKey(phoneDigits);
  return null;
}

/** Unifica conversas do mesmo telefone (ex.: @lid + @s.whatsapp.net). */
function dedupeChatsByPhone(chats: NormalizedChat[], session?: string): NormalizedChat[] {
  const map = new Map<string, NormalizedChat>();
  const orphans: NormalizedChat[] = [];

  for (const c of chats) {
    const phoneKey = canonicalDirectPhoneDigits(c, session);
    if (!phoneKey) {
      orphans.push(c);
      continue;
    }
    const key = `p:${phoneKey}`;
    const prev = map.get(key);
    const next = prev ? mergeTwoChats(prev, c) : { ...c, phone: phoneKey };
    map.set(key, next);
  }

  const remaining: NormalizedChat[] = [];
  for (const c of orphans) {
    if (session && isLikelyInternalLidJid(c.id)) {
      const mapped = getMappedPhoneJid(session, c.id);
      const pd = mapped ? digitsOnly(mapped) : "";
      if (isValidWhatsAppPhoneDigits(pd)) {
        const key = `p:${phoneDedupeKey(pd)}`;
        const prev = map.get(key);
        if (prev) {
          map.set(key, mergeTwoChats(prev, c));
          continue;
        }
      }
    }
    remaining.push(c);
  }

  return [...map.values(), ...remaining];
}

function preferChatId(a: string, b: string): string {
  const rank = (id: string) => {
    if (id.endsWith("@g.us")) return 5;
    if (id.endsWith("@s.whatsapp.net")) return 4;
    if (id.endsWith("@c.us")) return 3;
    if (id.endsWith("@lid")) return 1;
    return 0;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra > rb ? a : b;
  return a.length >= b.length ? a : b;
}

/** Fallback local `Grupo 876541` / `Comunidade 123456` — não é o assunto real. */
export function isPlaceholderGroupName(name: string): boolean {
  return /^(Grupo|Comunidade)\s+\d{1,12}$/i.test(name.trim());
}

function pickBetterName(a: NormalizedChat, b: NormalizedChat): string {
  const score = (c: NormalizedChat) => {
    if (!c.name || c.name === c.phone) return 0;
    if (isGenericSelfChatName(c.name)) return 0;
    if (isPlaceholderGroupName(c.name)) return 0;
    if (/^\d{10,}$/.test(c.name.replace(/\D/g, ""))) return 1;
    return c.name.length + (/\s/.test(c.name) ? 3 : 0);
  };
  return score(a) >= score(b) ? a.name : b.name;
}

export function mergeGroupSubjects(
  chats: NormalizedChat[],
  subjectsById: Map<string, string>
): NormalizedChat[] {
  if (subjectsById.size === 0) return chats;
  return chats.map((c) => {
    if (c.kind !== "group" && c.kind !== "community" && !c.isGroup) return c;
    const real = subjectsById.get(c.id)?.trim();
    if (!real) return c;
    if (!c.name || isPlaceholderGroupName(c.name) || c.name === c.id) {
      return { ...c, name: real };
    }
    return c;
  });
}

function resolveDirectChatName(
  chat: NormalizedChat,
  ownerDigits: string | null,
  namesByPhone: Map<string, string>
): NormalizedChat {
  if (chat.isGroup || chat.kind !== "direct") return chat;

  const phoneDigits = digitsOnly(chat.phone) || digitsOnly(chat.id);
  const fromContacts =
    phoneDigits && isValidWhatsAppPhoneDigits(phoneDigits)
      ? namesByPhone.get(phoneDigits) ??
        expandPhoneLookupKeys(phoneDigits)
          .map((k) => namesByPhone.get(digitsOnly(k)))
          .find(Boolean)
      : undefined;
  const isSelf = isOwnerPhoneDigits(phoneDigits, ownerDigits);

  if (isSelf) {
    const name = isGenericSelfChatName(chat.name) ? "Você" : chat.name;
    return { ...chat, name: name || "Você" };
  }

  if (fromContacts && fromContacts.trim()) {
    return { ...chat, name: fromContacts.trim() };
  }

  if (isGenericSelfChatName(chat.name) && isValidWhatsAppPhoneDigits(phoneDigits)) {
    return { ...chat, name: phoneDigits };
  }

  return chat;
}

function mergeTwoChats(a: NormalizedChat, b: NormalizedChat): NormalizedChat {
  const ts = Math.max(a.timestamp, b.timestamp);
  const ref = a.timestamp >= b.timestamp ? a : b;
  const other = a.timestamp >= b.timestamp ? b : a;
  return {
    ...ref,
    id: preferChatId(a.id, b.id),
    phone: digitsOnly(a.phone) || digitsOnly(b.phone) || a.phone || b.phone,
    name: pickBetterName(a, b),
    lastMessage: ref.lastMessage || other.lastMessage,
    timestamp: ts,
    unreadCount: Math.max(a.unreadCount, b.unreadCount)
  };
}

function mergeChats(map: Map<string, NormalizedChat>, list: NormalizedChat[], session?: string) {
  for (const c of list) {
    const key = chatDedupeKey(c, session);
    const prev = map.get(key);
    map.set(key, prev ? mergeTwoChats(prev, c) : c);
  }
}

/** Só é grupo/comunidade de verdade se o JID for @g.us / @newsletter. */
function isRealGroupJid(id: string): boolean {
  return id.includes("@g.us") || id.includes("@newsletter");
}

export function normalizeGroups(raw: unknown): NormalizedChat[] {
  const list = extractArray(raw);
  const out: NormalizedChat[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      const raw = item.trim();
      // Se o texto já é um telefone, NÃO force @g.us (viraria "grupo" falso).
      // O contato direto vem pelo list-chats; aqui a gente ignora.
      if (isPhoneLikeText(raw) && !raw.includes("@")) continue;
      const id = raw.includes("@") ? raw : `${raw.replace(/\D/g, "")}@g.us`;
      if (!isValidWaId(id) || !isRealGroupJid(id)) continue;
      out.push({
        id,
        phone: chatIdToPhone(id),
        name: item,
        lastMessage: "",
        timestamp: 0,
        isGroup: true,
        kind: id.includes("@newsletter") ? "community" : "group",
        unreadCount: 0,
        lastFromMe: false
      });
      continue;
    }
    const c = parseChatItem(item);
    if (!c) continue;
    // A Evolution às vezes devolve contato DIRETO na lista de grupos. Só marca
    // como grupo se o JID for realmente de grupo/comunidade; senão preserva o
    // que o parseChatItem detectou (evita conversa privada virar "Grupos").
    if (isRealGroupJid(c.id)) {
      c.kind = idIncludesCommunity(c.id) ? "community" : "group";
      c.isGroup = true;
    }
    out.push(c);
  }
  return out;
}

function idIncludesCommunity(id: string): boolean {
  return id.includes("@newsletter");
}

export type FetchChatsResult = {
  chats: NormalizedChat[];
  sourcesOk: string[];
  errors: string[];
  connected: boolean;
  ownerPhone?: string | null;
  ownerPhoneChanged?: boolean;
};

export const INBOX_EMPTY_CONNECTED_HINT =
  "Nenhuma conversa ainda neste número. Novas mensagens recebidas ou enviadas aparecem aqui automaticamente.";

function mergeContactNames(
  chats: NormalizedChat[],
  namesByPhone: Map<string, string>,
  ownerDigits: string | null
): NormalizedChat[] {
  return chats.map((c) => resolveDirectChatName(c, ownerDigits, namesByPhone));
}

async function loadEvolutionContactNames(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const raw = await wpp.listContacts();
    const list = extractArray(raw);
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id = extractWaId(o.id ?? o.jid ?? o.remoteJid ?? o.phone);
      // @lid e grupos não têm telefone: indexá-los pelos dígitos internos podia
      // colar o nome dessa entrada em um telefone real parecido.
      if (!id || isGroupLikeJid(id) || id.trim().endsWith("@lid")) continue;
      const phone = digitsOnly(id.replace(/@.*/, ""));
      const name = String(
        o.pushName ?? o.name ?? o.notify ?? o.verifiedName ?? o.shortName ?? ""
      ).trim();
      if (!phone || !name || !isValidWhatsAppPhoneDigits(phone)) continue;
      // Indexa com e sem o nono dígito: a agenda e o chat divergem nisso.
      for (const key of expandPhoneLookupKeys(phone)) {
        const d = digitsOnly(key);
        if (isValidWhatsAppPhoneDigits(d) && !map.has(d)) map.set(d, name);
      }
    }
  } catch {
    /* opcional */
  }
  return map;
}

export async function fetchChats(): Promise<FetchChatsResult> {
  const check = await wpp.verifyActiveSession();
  if (!check.connected) {
    return {
      chats: [],
      sourcesOk: [],
      errors: [
        check.message ??
          "WhatsApp não conectado. Vá em Configurações → Instâncias para conectar."
      ],
      connected: false
    };
  }

  const { getInboxSessionName } = await import("./inboxStore.js");
  const session = await getInboxSessionName();
  const { ensureInboxOwnerPhone } = await import("./inboxStore.js");
  const ownerSync = await ensureInboxOwnerPhone();
  await loadWaLidMap(session);

  const map = new Map<string, NormalizedChat>();
  const sourcesOk: string[] = [];
  const errors: string[] = [];

  const tasks: Array<{
    name: string;
    run: () => Promise<unknown>;
    parse: (raw: unknown) => NormalizedChat[];
  }> = [
    {
      name: "list-chats",
      run: () => wpp.listChats(),
      parse: (raw) => normalizeChats(raw, session)
    },
    {
      name: "all-groups",
      run: () => wpp.listGroups(),
      parse: normalizeGroups
    }
  ];

  const results = await Promise.allSettled(tasks.map((t) => t.run()));

  results.forEach((result, i) => {
    const task = tasks[i];
    if (result.status === "fulfilled") {
      const parsed = task.parse(result.value);
      if (parsed.length > 0) {
        sourcesOk.push(`${task.name} (${parsed.length})`);
        mergeChats(map, parsed, session);
      } else {
        errors.push(`${task.name}: resposta vazia`);
      }
    } else {
      const msg =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${task.name}: ${msg}`);
    }
  });

  if (check.connected) {
    const { listStoredChatSummaries, getInboxCaptureSince } = await import("./inboxStore.js");
    const stored = await listStoredChatSummaries();
    if (stored.length > 0) {
      mergeChats(map, stored, session);
      sourcesOk.push(`inbox-local (${stored.length})`);
    }

    const captureSince = await getInboxCaptureSince();
    const captureMs = captureSince?.getTime() ?? 0;
    const localKeys = new Set(stored.map((c) => chatDedupeKey(c, session)));

    const resolvedChats = [...map.values()].map((c) => {
      if (c.isGroup || !isLikelyInternalLidJid(c.id)) return c;
      const mapped = getMappedPhoneJid(session, c.id);
      if (!mapped) return c;
      return {
        ...c,
        id: mapped,
        phone: digitsOnly(mapped) || c.phone
      };
    });

    const resolvedMap = new Map<string, NormalizedChat>();
    mergeChats(resolvedMap, resolvedChats, session);
    const dedupedChats = [...resolvedMap.values()];

    const scopedChats =
      captureMs > 0
        ? dedupedChats.filter((c) => {
            const key = chatDedupeKey(c, session);
            if (localKeys.has(key)) return true;
            if (c.timestamp <= 0) return false;
            return c.timestamp >= captureMs - 60_000;
          })
        : dedupedChats;

    const needsGroupSubjects = scopedChats.some(
      (c) =>
        (c.kind === "group" || c.kind === "community" || c.isGroup) &&
        (!c.name.trim() || isPlaceholderGroupName(c.name))
    );
    const [contactNames, groupSubjects] = await Promise.all([
      loadEvolutionContactNames(),
      needsGroupSubjects ? wpp.fetchGroupSubjectMap() : Promise.resolve(new Map<string, string>())
    ]);

    const chats = dedupeChatsByPhone(
      mergeGroupSubjects(
        mergeContactNames(
          scopedChats.sort((a, b) => {
            if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
            return a.name.localeCompare(b.name, "pt-BR");
          }),
          contactNames,
          await wpp.getConnectedOwnerDigits()
        ),
        groupSubjects
      ).map((c) => ({
        ...c,
        unreadCount: isChatReadLocally(session, c.id) ? 0 : c.unreadCount
      })),
      session
    );

    const {
      getHiddenInboxContactKeys,
      isChatHiddenFromInbox,
      unhideContactFromInbox
    } = await import("./inboxStore.js");
    let hiddenKeys = await getHiddenInboxContactKeys(session);
    // Apagar conversa zera o DB e oculta o contato. Se já há mensagens locais de novo,
    // a pessoa falou outra vez — reabre o card (sem ressuscitar histórico apagado).
    if (hiddenKeys.size > 0 && stored.length > 0) {
      let unhid = false;
      for (const c of stored) {
        if (!isChatHiddenFromInbox(c, hiddenKeys, session)) continue;
        await unhideContactFromInbox(session, c.phone || c.id, c.id).catch(() => {});
        unhid = true;
      }
      if (unhid) hiddenKeys = await getHiddenInboxContactKeys(session);
    }
    const visibleChats =
      hiddenKeys.size === 0
        ? chats
        : chats.filter((c) => !isChatHiddenFromInbox(c, hiddenKeys, session));

    await flushWaLidMap(session);
    return {
      chats: visibleChats,
      sourcesOk,
      errors,
      connected: true,
      ownerPhone: ownerSync.phone,
      ownerPhoneChanged: ownerSync.changed
    };
  }

  await flushWaLidMap(session);
  return {
    chats: [],
    sourcesOk,
    errors,
    connected: true,
    ownerPhone: ownerSync.phone,
    ownerPhoneChanged: ownerSync.changed
  };
}

const INBOX_HINT_EMPTY =
  "Nenhuma mensagem gravada nesta instância ainda. Novas mensagens aparecem aqui automaticamente.";

export async function fetchMessages(
  _phone: string,
  options: FetchMessagesOptions
): Promise<{ messages: NormalizedMessage[]; hint?: string; captureSince?: string | null }> {
  const { getInboxSessionName, resolveAllChatIdsForContact, ensureInboxOwnerPhone } =
    await import("./inboxStore.js");
  const session = await getInboxSessionName();
  await ensureInboxOwnerPhone();
  await loadWaLidMap(session);

  let chatId = resolveChatId(options.chatId, options.isGroup);
  let mapped: string | null = null;
  if (!options.isGroup) {
    mapped = getMappedPhoneJid(session, chatId);
    if (mapped) chatId = mapped;
  }

  if (!options.skipSync) {
    try {
      const { syncRecentMessagesFromWpp } = await import("./inboxSync.js");
      const syncTargets = await resolveAllChatIdsForContact(session, chatId);
      const toSync = [...new Set([...syncTargets, options.chatId, chatId])];
      for (const target of toSync) {
        await syncRecentMessagesFromWpp(target, options.isGroup, 50, session);
      }
    } catch {
      /* webhook é o caminho principal; sync é fallback */
    }
  }
  let { messages, captureSince } = await listStoredMessages(
    chatId,
    options.count ?? 200,
    session
  );

  // Marcar como lido chama a Evolution. No poll rápido (skipSync) isso repetiria
  // a mesma chamada a cada 3s — já foi marcado na abertura e no sync completo.
  if (!options.skipSync) {
    void markInboxChatAsRead(chatId, options.isGroup).catch(() => {});
  }

  if (messages.length === 0 && options.chatId !== chatId) {
    const fallback = await listStoredMessages(options.chatId, options.count ?? 200, session);
    messages = fallback.messages;
    captureSince = fallback.captureSince;
  }

  // As tentativas abaixo chamam a Evolution para resolver variantes de chatId
  // (@lid ↔ telefone). Só valem no carregamento completo; no poll rápido
  // (skipSync) ficam de fora para não pesar.
  if (messages.length === 0 && !options.skipSync && !options.isGroup) {
    try {
      const { resolvePeerJid } = await import("./waha.js");
      const peer = await resolvePeerJid(options.chatId);
      if (peer && peer !== options.chatId) {
        await recordWaJidMapping(session, options.chatId, peer);
        const { syncRecentMessagesFromWpp } = await import("./inboxSync.js");
        await syncRecentMessagesFromWpp(peer, false, 50, session);
        await syncRecentMessagesFromWpp(options.chatId, false, 50, session);
        const retry = await listStoredMessages(peer, options.count ?? 200, session);
        messages = retry.messages;
        captureSince = retry.captureSince;
      }
    } catch {
      /* Evolution indisponível para resolver peer */
    }
  }

  if (messages.length === 0 && !options.skipSync && isLikelyInternalLidJid(options.chatId)) {
    try {
      const { resolvePeerJid } = await import("./waha.js");
      const peer = await resolvePeerJid(options.chatId);
      if (peer) {
        await recordWaJidMapping(session, options.chatId, peer);
        const retry = await listStoredMessages(peer, options.count ?? 200, session);
        messages = retry.messages;
        captureSince = retry.captureSince;
      }
    } catch {
      /* Evolution indisponível para resolver @lid */
    }
  }

  if (messages.length === 0) {
    return { messages: [], hint: INBOX_HINT_EMPTY, captureSince };
  }

  return { messages, captureSince };
}

export async function sendChatMessage(
  chatId: string,
  message: string,
  isGroup = false,
  /** "manual" (atendente) por padrão; "ai" quando a própria IA envia. */
  source: "manual" | "ai" | "flow" = "manual"
): Promise<void> {
  const { canonicalizeChatId } = await import("./inboxStore.js");
  const session = await wpp.getActiveWppSessionName();
  const target = buildWppSendTarget(chatId, isGroup);
  const canonical = await canonicalizeChatId(session, chatId, [target.jid, chatId]);

  // AI/flow: grava antes do send para o eco da Evolution não armar modo humano.
  let savedId: string | null = null;
  if (source === "ai" || source === "flow") {
    const saved = await saveInboxMessage({
      chatId: canonical,
      body: message,
      fromMe: true,
      source,
      type: "chat",
      peerJids: [target.jid, chatId, canonical]
    });
    savedId = saved?.id ?? null;
  }

  const waMessageId = await sendWppText(chatId, message, isGroup);

  if (source === "ai" || source === "flow") {
    if (savedId && waMessageId && prisma) {
      await prisma.inboxMessage
        .update({
          where: { id: savedId },
          data: { waMessageId: waMessageId.slice(0, 240) }
        })
        .catch(() => {});
    }
    return;
  }

  await saveInboxMessage({
    chatId: canonical,
    body: message,
    fromMe: true,
    source,
    type: "chat",
    waMessageId,
    peerJids: [target.jid, chatId, canonical]
  });
}

type PreparedMedia = {
  publicUrl: string;
  wppPath: string;
  filename: string;
  base64?: string;
};

async function prepareMediaForSend(
  url: string,
  mimeHint?: string,
  filenameHint?: string
): Promise<PreparedMedia> {
  if (url.startsWith("data:")) {
    const saved = await saveUploadFromData(url, mimeHint);
    const file = await readUploadFileBase64(saved.url);
    return {
      publicUrl: saved.url,
      wppPath: rewriteUploadUrlForWpp(saved.url),
      filename: saved.filename,
      base64: file?.base64
    };
  }

  const existingName = uploadFilenameFromUrl(url);
  if (existingName) {
    const publicUrl = toPublicMediaUrl(url) ?? url;
    const file = await readUploadFileBase64(publicUrl);
    return {
      publicUrl,
      wppPath: rewriteUploadUrlForWpp(publicUrl),
      filename: filenameHint || existingName,
      base64: file?.base64
    };
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    const name = filenameHint || url.split("/").pop()?.split("?")[0] || "arquivo.bin";
    return {
      publicUrl: url,
      wppPath: rewriteUploadUrlForWpp(url),
      filename: name
    };
  }

  const saved = await saveUploadFromData(url, mimeHint);
  const file = await readUploadFileBase64(saved.url);
  return {
    publicUrl: saved.url,
    wppPath: rewriteUploadUrlForWpp(saved.url),
    filename: saved.filename,
    base64: file?.base64
  };
}

async function sendFileToWpp(
  payload: Record<string, unknown>,
  media: PreparedMedia,
  caption: string,
  opts?: { sendAs?: "document" | "video" | "image" | "auto" }
): Promise<string | null> {
  const body: Record<string, unknown> = {
    ...payload,
    filename: media.filename,
    caption,
    ...(opts?.sendAs ? { sendAs: opts.sendAs } : {})
  };

  const isVideo = /\.(mp4|webm|mov|mkv)(\?|$)/i.test(media.filename);
  const base64Bytes = media.base64 ? Buffer.byteLength(media.base64, "base64") : 0;
  const preferUrl = isVideo || base64Bytes > MEDIA_SEND_URL_THRESHOLD_BYTES;

  if (media.base64 && !preferUrl) {
    try {
      const raw = await sendWppApi("/send-file", { ...body, base64: media.base64 });
      return extractWppMessageId(raw);
    } catch {
      /* tenta path */
    }
  }

  const raw = await sendWppApi("/send-file", { ...body, path: media.wppPath });
  return extractWppMessageId(raw);
}

function base64FromDataUrl(url: string): string {
  const i = url.indexOf(",");
  return i >= 0 ? url.slice(i + 1) : url;
}

export async function sendChatMedia(
  chatId: string,
  type: "image" | "video" | "audio" | "document",
  url: string,
  options?: {
    caption?: string;
    isGroup?: boolean;
    filename?: string;
    /** "manual" (atendente) por padrão; "ai" quando a própria IA dispara a mídia. */
    source?: "manual" | "ai" | "flow";
  }
): Promise<void> {
  const target = buildWppSendTarget(chatId, options?.isGroup);
  const base = {
    phone: target.phone,
    isGroup: target.isGroup,
    isLid: target.isLid,
    isNewsletter: target.isNewsletter
  };
  const caption = options?.caption ?? "";
  let storedMediaUrl: string | null = null;
  let waMessageId: string | null = null;
  const sentAt = new Date();

  const runMediaSend = async (lid = false) => {
    const payload = { ...base, isLid: lid || base.isLid };

    if (type === "audio" && url.startsWith("data:")) {
      const mime = url.match(/^data:([^;]+)/)?.[1] ?? "audio/webm";
      let base64Ptt: string;
      if (mime.includes("webm")) {
        try {
          const converted = await convertWebmDataUrlToOgg(url);
          base64Ptt = converted.base64;
          storedMediaUrl = converted.url;
        } catch {
          base64Ptt = base64FromDataUrl(url);
          const saved = await saveUploadFromData(url, mime);
          storedMediaUrl = saved.url;
        }
      } else {
        base64Ptt = base64FromDataUrl(url);
        const saved = await saveUploadFromData(url, mime);
        storedMediaUrl = saved.url;
      }
      waMessageId = extractWppMessageId(
        await sendWppApi("/send-voice-base64", { ...payload, base64Ptt })
      );
      return;
    }

    const media = await prepareMediaForSend(url, undefined, options?.filename);
    storedMediaUrl = media.publicUrl;

    if (type === "image") {
      const name = options?.filename ?? media.filename ?? "image.jpg";
      try {
        waMessageId = await sendFileToWpp(payload, { ...media, filename: name }, caption);
      } catch {
        waMessageId = extractWppMessageId(
          await sendWppApi("/send-image", { ...payload, path: media.wppPath, caption })
        );
      }
      return;
    }
    if (type === "video") {
      const name = options?.filename ?? media.filename ?? "video.mp4";
      const bytes =
        (media.base64 ? Buffer.byteLength(media.base64, "base64") : null) ??
        (await getUploadFileSize(media.publicUrl)) ??
        0;
      const sendAs = bytes > WHATSAPP_INLINE_VIDEO_MAX_BYTES ? "document" : "auto";
      waMessageId = await sendFileToWpp(
        payload,
        { ...media, filename: name },
        caption,
        sendAs === "document" ? { sendAs: "document" } : undefined
      );
      return;
    }
    if (type === "audio") {
      if (media.base64) {
        waMessageId = extractWppMessageId(
          await sendWppApi("/send-voice-base64", { ...payload, base64Ptt: media.base64 })
        );
      } else {
        waMessageId = extractWppMessageId(
          await sendWppApi("/send-voice", { ...payload, path: media.wppPath })
        );
      }
      return;
    }
    const name = options?.filename ?? media.filename ?? "documento.pdf";
    waMessageId = await sendFileToWpp(payload, { ...media, filename: name }, caption);
  };

  try {
    await runMediaSend(false);
  } catch (first) {
    if (base.isLid || base.isGroup) throw first;
    await runMediaSend(true);
  }

  const labels: Record<string, string> = {
    image: caption || "📷 Imagem",
    video: caption || "🎬 Vídeo",
    audio: "🎤 Áudio",
    document: caption || "📎 Documento"
  };

  const { canonicalizeChatId } = await import("./inboxStore.js");
  const session = await wpp.getActiveWppSessionName();
  const canonical = await canonicalizeChatId(session, chatId, [target.jid, chatId]);

  await saveInboxMessage({
    chatId: canonical,
    body: labels[type],
    fromMe: true,
    source: options?.source ?? "manual",
    type,
    mediaUrl: toPublicMediaUrl(storedMediaUrl) ?? storedMediaUrl,
    waMessageId,
    timestamp: sentAt,
    peerJids: [target.jid, chatId, canonical]
  });
}
