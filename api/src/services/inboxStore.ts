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
import { normalizeDirectJid } from "./waJid.js";
import {
  expandChatIdVariants,
  getMappedPhoneJid,
  loadWaLidMap,
  pickPhoneJid,
  recordWaJidMapping
} from "./waLidMap.js";

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

  if (raw.includes("@g.us") || chatId.includes("@g.us")) {
    add(`${digits}@g.us`);
  } else {
    add(`${digits}@c.us`);
    add(`${digits}@lid`);
    add(`${digits}@s.whatsapp.net`);
  }
  if (raw.includes("@") && !out.includes(raw)) add(raw);
  return out;
}

async function chatIdVariantsResolved(session: string, chatId: string): Promise<string[]> {
  await loadWaLidMap(session);
  return expandChatIdVariants(session, chatId);
}

async function getSessionName(): Promise<string> {
  if (!prisma) return "default";
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return (s?.wppSession ?? "default").trim().toLowerCase();
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

type SessionInboxState = { ownerPhone?: string; captureSince?: string };

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

function ownerPhoneFilter(ownerPhone: string | null): { OR?: Array<{ ownerPhone: string }> } {
  if (!ownerPhone) return {};
  // Mensagens gravadas antes do ownerPhone sincronizar ficam com "".
  return { OR: [{ ownerPhone }, { ownerPhone: "" }] };
}

async function resolveStorageChatId(
  session: string,
  chatId: string,
  peerJids: string[] = []
): Promise<string> {
  await recordWaJidMapping(session, chatId, ...peerJids);
  const mapped = getMappedPhoneJid(session, chatId);
  if (mapped) return mapped;
  const phone = pickPhoneJid([chatId, ...peerJids]);
  if (phone) {
    await recordWaJidMapping(session, chatId, phone, ...peerJids);
    return phone;
  }
  return chatId;
}

export type InboxOwnerSyncResult = {
  phone: string | null;
  changed: boolean;
  previousPhone: string | null;
};

/**
 * Detecta troca de número na instância ativa e isola o histórico por telefone.
 * Mensagens antigas permanecem no banco (ownerPhone anterior) mas deixam de aparecer.
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

  if (previousPhone === phone) {
    if (hadSessionEntry) {
      return { phone, changed: false, previousPhone };
    }
    await setSessionInboxState(session, { ownerPhone: phone, captureSince: new Date() });
    const { clearWaLidMap } = await import("./waLidMap.js");
    await clearWaLidMap(session);
    return { phone, changed: false, previousPhone };
  }

  const now = new Date();
  await setSessionInboxState(session, { ownerPhone: phone, captureSince: now });

  const { clearWaLidMap } = await import("./waLidMap.js");
  await clearWaLidMap(session);

  return {
    phone,
    changed: previousPhone !== null && previousPhone !== phone,
    previousPhone
  };
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

function inboxMessageDedupeKey(row: {
  waMessageId: string | null;
  fromMe: boolean;
  body: string;
  timestamp: Date;
  chatId: string;
}): string {
  if (row.waMessageId) return `wa:${row.waMessageId}`;
  const sec = Math.floor(row.timestamp.getTime() / 1000);
  return `${row.fromMe ? 1 : 0}|${row.body}|${sec}|${row.chatId}`;
}

async function findDuplicateInboxMessage(params: {
  session: string;
  ownerPhone: string;
  chatId: string;
  body: string;
  fromMe: boolean;
  waMessageId: string | null;
  timestamp: Date;
}): Promise<{ id: string; waMessageId: string | null } | null> {
  if (!prisma) return null;

  const ownerWhere = ownerPhoneFilter(params.ownerPhone || null);

  if (params.waMessageId) {
    const byWaId = await prisma.inboxMessage.findFirst({
      where: { session: params.session, waMessageId: params.waMessageId, ...ownerWhere },
      select: { id: true, waMessageId: true }
    });
    if (byWaId) return byWaId;
  }

  const variants = await chatIdVariantsResolved(params.session, params.chatId);
  const windowStart = new Date(params.timestamp.getTime() - 120_000);
  const windowEnd = new Date(params.timestamp.getTime() + 45_000);

  return prisma.inboxMessage.findFirst({
    where: {
      session: params.session,
      ...ownerWhere,
      chatId: { in: variants },
      fromMe: params.fromMe,
      body: params.body,
      timestamp: { gte: windowStart, lte: windowEnd }
    },
    orderBy: { timestamp: "desc" },
    select: { id: true, waMessageId: true }
  });
}

export async function saveInboxMessage(params: {
  chatId: string;
  body: string;
  fromMe: boolean;
  type?: string;
  mediaUrl?: string | null;
  waMessageId?: string | null;
  timestamp?: Date;
  sessionName?: string;
  ownerPhone?: string | null;
  peerJids?: string[];
}): Promise<void> {
  if (!prisma) return;

  const session = (params.sessionName ?? (await getSessionName())).trim().toLowerCase();
  const ownerPhone = await resolveOwnerPhoneForSave(session, params.ownerPhone);
  const rawChatId = normalizeDirectJid(extractWaId(params.chatId) || params.chatId.trim());
  if (!rawChatId || rawChatId.includes("status@broadcast")) return;
  const chatId = await resolveStorageChatId(session, rawChatId, params.peerJids ?? []);

  const type = params.type ?? "chat";
  const { body, mediaUrl } = await resolveStoredMedia(type, params.body, params.mediaUrl);
  const waMessageId = params.waMessageId?.slice(0, 240) ?? null;
  const timestamp = params.timestamp ?? new Date();

  const duplicate = await findDuplicateInboxMessage({
    session,
    ownerPhone,
    chatId,
    body,
    fromMe: params.fromMe,
    waMessageId,
    timestamp
  });
  if (duplicate) {
    if (waMessageId && !duplicate.waMessageId) {
      await prisma.inboxMessage.update({
        where: { id: duplicate.id },
        data: { waMessageId }
      });
    }
    return;
  }

  await recordWaJidMapping(session, chatId, ...(params.peerJids ?? []), params.chatId).catch(
    () => {}
  );

  await prisma.inboxMessage.create({
    data: {
      session,
      ownerPhone,
      chatId,
      body,
      fromMe: params.fromMe,
      type,
      mediaUrl,
      waMessageId,
      timestamp
    }
  });
}

export async function updateInboxMessageMedia(
  waMessageId: string,
  mediaUrl: string
): Promise<void> {
  if (!prisma || !waMessageId) return;
  const session = await getSessionName();
  const ownerPhone = await getStoredOwnerPhone();
  const publicUrl = toPublicMediaUrl(mediaUrl) ?? mediaUrl;
  await prisma.inboxMessage.updateMany({
    where: { session, waMessageId: waMessageId.slice(0, 240), ...ownerPhoneFilter(ownerPhone) },
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
  const ownerPhone = await getStoredOwnerPhone();
  const captureSince = await getCaptureSince();
  await loadWaLidMap(session);
  const rows = await prisma.inboxMessage.findMany({
    where: {
      session,
      ...ownerPhoneFilter(ownerPhone),
      ...(captureSince ? { timestamp: { gte: captureSince } } : {})
    },
    orderBy: { timestamp: "desc" },
    distinct: ["chatId"],
    take: 200,
    select: { chatId: true, body: true, timestamp: true }
  });

  return rows.map((r) => {
    let id = r.chatId;
    const mapped = getMappedPhoneJid(session, id);
    if (mapped) id = mapped;
    const isGroup = id.includes("@g.us");
    const phone = digitsOnly(id.replace(/@.*/, "")) || id.replace(/@.*/, "");
    return {
      id,
      phone,
      name: phone,
      lastMessage: r.body.slice(0, 120),
      timestamp: r.timestamp.getTime(),
      isGroup,
      kind: isGroup ? ("group" as const) : ("direct" as const),
      unreadCount: 0
    };
  });
}

export async function listStoredMessages(
  chatId: string,
  limit = 200
): Promise<{ messages: NormalizedMessage[]; captureSince: string | null }> {
  if (!prisma) {
    return { messages: [], captureSince: null };
  }

  const session = await getSessionName();
  const ownerPhone = await getStoredOwnerPhone();
  const variants = await chatIdVariantsResolved(session, chatId);
  const captureSince = await getCaptureSince();

  const rows = await prisma.inboxMessage.findMany({
    where: {
      session,
      ...ownerPhoneFilter(ownerPhone),
      chatId: { in: variants },
      ...(captureSince ? { timestamp: { gte: captureSince } } : {})
    },
    orderBy: { timestamp: "desc" },
    take: limit
  });
  rows.reverse();

  const seen = new Set<string>();
  const seenContent = new Set<string>();
  const dedupedRows = rows.filter((r) => {
    const key = inboxMessageDedupeKey(r);
    if (seen.has(key)) return false;
    seen.add(key);

    if (!r.waMessageId) {
      const sec = Math.floor(r.timestamp.getTime() / 1000);
      const contentKey = `${r.fromMe ? 1 : 0}|${r.type}|${r.body}|${sec}|${r.chatId}`;
      if (seenContent.has(contentKey)) return false;
      seenContent.add(contentKey);
    }
    return true;
  });

  dedupedRows.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const { isInboundMediaType, downloadMediaForStoredMessage } = await import("./wppMedia.js");
  const hydrateCandidates = dedupedRows
    .filter((r) => !r.mediaUrl && r.waMessageId && isInboundMediaType(r.type === "ptt" ? "audio" : r.type))
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
    captureSince: captureSince?.toISOString() ?? null
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
