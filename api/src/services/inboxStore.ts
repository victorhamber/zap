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
  if (!prisma) return null;
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return s?.inboxCaptureSince ?? null;
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
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { inboxCaptureSince: new Date() }
  });
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
  mediaUrl: string | null | undefined,
  fromMe: boolean
): Promise<{ body: string; mediaUrl: string | null }> {
  const rawText = text.trim();

  if (!fromMe) {
    let url = mediaUrl ?? null;
    if (url?.startsWith("data:") || (url && !isPersistedUploadUrl(url))) {
      url = null;
    }
    let body = rawText;
    if (isLikelyBase64Payload(body)) {
      body = captionFromText(type, "") || labelForMediaType(type) || "Mídia";
    } else {
      body = captionFromText(type, body);
    }
    return { body, mediaUrl: url ? toPublicMediaUrl(url) : null };
  }

  let url = mediaUrl ?? null;

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
  chatId: string;
  body: string;
  fromMe: boolean;
  waMessageId: string | null;
  timestamp: Date;
}): Promise<{ id: string; waMessageId: string | null } | null> {
  if (!prisma) return null;

  if (params.waMessageId) {
    const byWaId = await prisma.inboxMessage.findFirst({
      where: { session: params.session, waMessageId: params.waMessageId },
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
  peerJids?: string[];
}): Promise<void> {
  if (!prisma) return;

  const session = (params.sessionName ?? (await getSessionName())).trim().toLowerCase();
  const chatId = normalizeDirectJid(extractWaId(params.chatId) || params.chatId.trim());
  if (!chatId || chatId.includes("status@broadcast")) return;

  const type = params.type ?? "chat";
  const { body, mediaUrl } = await resolveStoredMedia(
    type,
    params.body,
    params.mediaUrl,
    params.fromMe
  );
  const waMessageId = params.waMessageId?.slice(0, 240) ?? null;
  const timestamp = params.timestamp ?? new Date();

  const duplicate = await findDuplicateInboxMessage({
    session,
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

export async function fetchInboxMessageMedia(
  messageId: string
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  if (!prisma) return { ok: false, message: "Banco indisponível" };

  const row = await prisma.inboxMessage.findUnique({ where: { id: messageId } });
  if (!row) return { ok: false, message: "Mensagem não encontrada" };

  const existing = toPublicMediaUrl(row.mediaUrl);
  if (existing && isPersistedUploadUrl(existing)) {
    return { ok: true, url: existing };
  }

  if (!row.waMessageId) {
    return { ok: false, message: "Esta mensagem não tem mídia disponível para download" };
  }

  const type = row.type === "ptt" ? "audio" : row.type;
  const { isInboundMediaType, downloadMediaForStoredMessage } = await import("./wppMedia.js");
  if (!isInboundMediaType(type)) {
    return { ok: false, message: "Não é uma mensagem de mídia" };
  }

  try {
    const url = await downloadMediaForStoredMessage({
      chatId: row.chatId,
      waMessageId: row.waMessageId,
      type
    });
    if (!url) return { ok: false, message: "Não foi possível baixar a mídia" };

    const publicUrl = toPublicMediaUrl(url) ?? url;
    await prisma.inboxMessage.update({
      where: { id: messageId },
      data: { mediaUrl: publicUrl }
    });
    return { ok: true, url: publicUrl };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message };
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
  const captureSince = await getCaptureSince();
  const rows = await prisma.inboxMessage.findMany({
    where: {
      session,
      ...(captureSince ? { timestamp: { gte: captureSince } } : {})
    },
    orderBy: { timestamp: "desc" },
    distinct: ["chatId"],
    take: 200,
    select: { chatId: true, body: true, timestamp: true }
  });

  return rows.map((r) => {
    const id = r.chatId;
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
  const variants = await chatIdVariantsResolved(session, chatId);
  const captureSince = await getCaptureSince();

  const rows = await prisma.inboxMessage.findMany({
    where: {
      session,
      chatId: { in: variants },
      ...(captureSince ? { timestamp: { gte: captureSince } } : {})
    },
    orderBy: { timestamp: "asc" },
    take: limit
  });

  const seen = new Set<string>();
  const seenContent = new Set<string>();
  const dedupedRows = rows.filter((r) => {
    const key = inboxMessageDedupeKey(r);
    const sec = Math.floor(r.timestamp.getTime() / 1000);
    const contentKey = `${r.fromMe ? 1 : 0}|${r.body}|${sec}`;
    if (seen.has(key) || seenContent.has(contentKey)) return false;
    seen.add(key);
    seenContent.add(contentKey);
    return true;
  });

  dedupedRows.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const messages: NormalizedMessage[] = dedupedRows.map((r) => {
    let body = r.body;
    let mediaUrl = toPublicMediaUrl(r.mediaUrl) ?? r.mediaUrl;
    const normalizedType = r.type === "ptt" ? "audio" : r.type;
    if (!mediaUrl && isLikelyBase64Payload(body)) {
      if (r.fromMe) {
        mediaUrl =
          body.startsWith("data:")
            ? body
            : `data:${mimeFromMessageType(normalizedType)};base64,${body.replace(/\s/g, "")}`;
      }
      body = labelForMediaType(normalizedType) || "Mídia";
    } else if (isLikelyBase64Payload(body)) {
      body = labelForMediaType(r.type) || body.slice(0, 40);
    }
    const mediaPending =
      !mediaUrl &&
      !r.fromMe &&
      ["image", "video", "audio", "document", "sticker", "ptt"].includes(normalizedType);
    return {
      id: r.id,
      body,
      fromMe: r.fromMe,
      timestamp: r.timestamp.getTime(),
      type: normalizedType,
      mediaUrl,
      waMessageId: r.waMessageId,
      mediaPending
    };
  });

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
