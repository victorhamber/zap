import * as wpp from "./whatsapp/index.js";
import { listStoredMessages, saveInboxMessage } from "./inboxStore.js";
import { buildWppSendTarget, sendWppApi, sendWppText } from "./wppSend.js";
import { convertWebmDataUrlToOgg } from "./mediaConvert.js";
import {
  canonicalEvolutionChatId,
  digitsOnly,
  isLikelyInternalLidJid,
  isValidWhatsAppPhoneDigits,
  normalizeDirectJid
} from "./waJid.js";
import {
  readUploadFileBase64,
  rewriteUploadUrlForWpp,
  saveUploadFromData,
  toPublicMediaUrl,
  uploadFilenameFromUrl
} from "./uploads.js";

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
  return digitsOnly(base) || base;
}

function resolveChatId(chatId: string, isGroup?: boolean): string {
  if (chatId.includes("@")) return chatId;
  const clean = digitsOnly(chatId);
  if (!clean) return chatId;
  if (isGroup) return `${clean}@g.us`;
  return `${clean}@c.us`;
}

function detectKind(id: string, o?: Record<string, unknown>): ChatKind {
  if (id.includes("@newsletter") || o?.isCommunity === true) return "community";
  if (id.includes("@g.us") || o?.isGroup === true) return "group";
  return "direct";
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
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    const n = Date.parse(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function parseChatItem(item: unknown): NormalizedChat | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;

  const peer = canonicalEvolutionChatId({
    remoteJid: o.remoteJid ?? o.id ?? o.jid ?? o._id ?? o.chatId,
    remoteJidAlt: o.remoteJidAlt ?? o.remoteJidalt ?? o.pn,
    participant: o.participant,
    participantAlt: o.participantAlt
  });

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
  let resolvedId = rawId.includes("@")
    ? normalizeDirectJid(rawId)
    : normalizeDirectJid(
        resolveChatId(rawId, kindHint === "group" || kindHint === "community" || o.isGroup === true)
      );
  if (!isValidWaId(resolvedId)) return null;

  const displayName = String(
    o.pushName ?? o.name ?? o.formattedTitle ?? ""
  ).trim();
  if (isLikelyInternalLidJid(resolvedId) && !displayName) return null;

  const phoneDigits = digitsOnly(resolvedId);
  const phone = isValidWhatsAppPhoneDigits(phoneDigits)
    ? phoneDigits
    : displayName
      ? ""
      : resolvedId.split("@")[0];
  const contactObj =
    o.contact && typeof o.contact === "object"
      ? (o.contact as Record<string, unknown>)
      : null;
  const kind = detectKind(resolvedId, o);
  const name = String(
    o.pushName ??
      o.name ??
      o.formattedTitle ??
      contactObj?.name ??
      o.pushname ??
      o.shortName ??
      (kind === "direct" ? phone : resolvedId.split("@")[0])
  );
  const lastMsg =
    o.lastMessage && typeof o.lastMessage === "object"
      ? (o.lastMessage as Record<string, unknown>)
      : o;

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

  return {
    id: resolvedId,
    phone,
    name: name || phone || "Contato",
    lastMessage: lastBody.slice(0, 120),
    timestamp: ts,
    isGroup,
    kind,
    unreadCount: Number(o.unreadCount ?? o.unread ?? 0) || 0
  };
}

export function normalizeChats(raw: unknown): NormalizedChat[] {
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

  return list.map(parseChatItem).filter((c): c is NormalizedChat => Boolean(c));
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
function chatDedupeKey(c: NormalizedChat): string {
  if (c.isGroup || c.kind !== "direct") {
    const gid = digitsOnly(c.id) || c.id.replace(/@.*/, "");
    return `g:${gid}`;
  }
  const d = digitsOnly(c.id);
  if (isValidWhatsAppPhoneDigits(d)) return `p:${d}`;
  if (c.name && c.name !== d) return `n:${c.name.toLowerCase()}`;
  return `id:${c.id}`;
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

function pickBetterName(a: NormalizedChat, b: NormalizedChat): string {
  const score = (c: NormalizedChat) => {
    if (!c.name || c.name === c.phone) return 0;
    return c.name.length + (/\s/.test(c.name) ? 3 : 0);
  };
  return score(a) >= score(b) ? a.name : b.name;
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

function mergeChats(map: Map<string, NormalizedChat>, list: NormalizedChat[]) {
  for (const c of list) {
    const key = chatDedupeKey(c);
    const prev = map.get(key);
    map.set(key, prev ? mergeTwoChats(prev, c) : c);
  }
}

export function normalizeGroups(raw: unknown): NormalizedChat[] {
  const list = extractArray(raw);
  const out: NormalizedChat[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      const raw = item.trim();
      const id = raw.includes("@") ? raw : `${raw.replace(/\D/g, "")}@g.us`;
      if (!isValidWaId(id)) continue;
      out.push({
        id,
        phone: chatIdToPhone(id),
        name: item,
        lastMessage: "",
        timestamp: 0,
        isGroup: true,
        kind: "group",
        unreadCount: 0
      });
      continue;
    }
    const c = parseChatItem(item);
    if (!c) continue;
    c.kind = idIncludesCommunity(c.id) ? "community" : "group";
    c.isGroup = true;
    if (!c.id.includes("@")) c.id = `${c.phone}@g.us`;
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
};

export async function fetchChats(): Promise<FetchChatsResult> {
  const check = await wpp.verifyActiveSession();
  if (!check.connected) {
    return {
      chats: [],
      sourcesOk: [],
      errors: [
        check.message ??
          "WhatsApp não conectado. Use Conexão / QR e escaneie o código antes de abrir o Inbox."
      ]
    };
  }

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
      run: () => wpp.callSessionApi("/list-chats", "POST", { onlyUsers: true }),
      parse: normalizeChats
    },
    {
      name: "all-groups",
      run: () => wpp.callSessionApi("/all-groups", "GET"),
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
        mergeChats(map, parsed);
      } else {
        errors.push(`${task.name}: resposta vazia`);
      }
    } else {
      const msg =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${task.name}: ${msg}`);
    }
  });

  if (map.size === 0 && check.connected) {
    const { listStoredChatSummaries } = await import("./inboxStore.js");
    const stored = await listStoredChatSummaries();
    if (stored.length > 0) {
      mergeChats(map, stored);
      sourcesOk.push(`inbox-local (${stored.length})`);
    }
  }

  const chats = [...map.values()].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
    return a.name.localeCompare(b.name, "pt-BR");
  });
  return { chats, sourcesOk, errors };
}

const INBOX_HINT_EMPTY =
  "Nenhuma mensagem desde a conexão. O Zap não importa histórico antigo do WhatsApp — novas mensagens aparecem aqui automaticamente.";

export async function fetchMessages(
  _phone: string,
  options: FetchMessagesOptions
): Promise<{ messages: NormalizedMessage[]; hint?: string; captureSince?: string | null }> {
  const chatId = resolveChatId(options.chatId, options.isGroup);
  try {
    const { syncRecentMessagesFromWpp } = await import("./inboxSync.js");
    await syncRecentMessagesFromWpp(chatId, options.isGroup, 40);
  } catch {
    /* webhook é o caminho principal; sync é fallback */
  }
  const { messages, captureSince } = await listStoredMessages(chatId, options.count ?? 200);

  if (messages.length === 0) {
    return { messages: [], hint: INBOX_HINT_EMPTY, captureSince };
  }

  return { messages, captureSince };
}

export async function sendChatMessage(
  chatId: string,
  message: string,
  isGroup = false
): Promise<void> {
  const target = buildWppSendTarget(chatId, isGroup);
  await sendWppText(chatId, message, isGroup);
  await saveInboxMessage({
    chatId: target.jid,
    body: message,
    fromMe: true,
    type: "chat"
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
  caption: string
): Promise<void> {
  const body: Record<string, unknown> = {
    ...payload,
    filename: media.filename,
    caption
  };

  if (media.base64) {
    try {
      await sendWppApi("/send-file", { ...body, base64: media.base64 });
      return;
    } catch {
      /* tenta path */
    }
  }

  await sendWppApi("/send-file", { ...body, path: media.wppPath });
}

function base64FromDataUrl(url: string): string {
  const i = url.indexOf(",");
  return i >= 0 ? url.slice(i + 1) : url;
}

export async function sendChatMedia(
  chatId: string,
  type: "image" | "video" | "audio" | "document",
  url: string,
  options?: { caption?: string; isGroup?: boolean; filename?: string }
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
          const media = await prepareMediaForSend(url, mime);
          await sendWppApi("/send-voice", { ...payload, path: media.wppPath });
          storedMediaUrl = media.publicUrl;
          return;
        }
      } else {
        base64Ptt = base64FromDataUrl(url);
        const saved = await saveUploadFromData(url, mime);
        storedMediaUrl = saved.url;
      }
      await sendWppApi("/send-voice-base64", {
        ...payload,
        base64Ptt
      });
      return;
    }

    const media = await prepareMediaForSend(url, undefined, options?.filename);
    storedMediaUrl = media.publicUrl;

    if (type === "image") {
      const name = options?.filename ?? media.filename ?? "image.jpg";
      try {
        await sendFileToWpp(payload, { ...media, filename: name }, caption);
      } catch {
        await sendWppApi("/send-image", { ...payload, path: media.wppPath, caption });
      }
      return;
    }
    if (type === "video") {
      const name = options?.filename ?? media.filename ?? "video.mp4";
      await sendFileToWpp(payload, { ...media, filename: name }, caption);
      return;
    }
    if (type === "audio") {
      if (media.base64) {
        await sendWppApi("/send-voice-base64", { ...payload, base64Ptt: media.base64 });
      } else {
        await sendWppApi("/send-voice", { ...payload, path: media.wppPath });
      }
      return;
    }
    const name = options?.filename ?? media.filename ?? "documento.pdf";
    await sendFileToWpp(payload, { ...media, filename: name }, caption);
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

  await saveInboxMessage({
    chatId: target.jid,
    body: labels[type],
    fromMe: true,
    type,
    mediaUrl: toPublicMediaUrl(storedMediaUrl) ?? storedMediaUrl
  });
}
