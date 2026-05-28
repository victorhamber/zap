import { prisma } from "../prisma.js";
import { extractWaId, type NormalizedMessage } from "./inbox.js";
import { persistInboundMedia } from "./mediaConvert.js";
import {
  captionFromText,
  isLikelyBase64Payload,
  labelForMediaType,
  mimeFromMessageType
} from "./mediaText.js";

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
  }
  return out;
}

async function getSessionName(): Promise<string> {
  if (!prisma) return "default";
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return s?.wppSession ?? "default";
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

function extractMediaUrl(body: Record<string, unknown>): string | null {
  const keys = ["mediaUrl", "fileUrl", "clientUrl", "deprecatedMms3Url"] as const;
  for (const key of keys) {
    const v = body[key];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
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
  return { body, mediaUrl: url };
}

export async function saveInboxMessage(params: {
  chatId: string;
  body: string;
  fromMe: boolean;
  type?: string;
  mediaUrl?: string | null;
  waMessageId?: string | null;
  timestamp?: Date;
}): Promise<void> {
  if (!prisma) return;

  const session = await getSessionName();
  const chatId = extractWaId(params.chatId) || params.chatId.trim();
  if (!chatId || chatId.includes("status@broadcast")) return;

  const type = params.type ?? "chat";
  const { body, mediaUrl } = await resolveStoredMedia(
    type,
    params.body,
    params.mediaUrl
  );
  const waMessageId = params.waMessageId?.slice(0, 240) ?? null;
  const timestamp = params.timestamp ?? new Date();

  if (waMessageId) {
    const dup = await prisma.inboxMessage.findFirst({
      where: { session, waMessageId }
    });
    if (dup) return;
  }

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

export async function listStoredMessages(
  chatId: string,
  limit = 200
): Promise<{ messages: NormalizedMessage[]; captureSince: string | null }> {
  if (!prisma) {
    return { messages: [], captureSince: null };
  }

  const session = await getSessionName();
  const variants = chatIdVariants(chatId);
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

  const messages: NormalizedMessage[] = rows.map((r) => {
    let body = r.body;
    let mediaUrl = r.mediaUrl;
    if (!mediaUrl && isLikelyBase64Payload(body)) {
      mediaUrl =
        body.startsWith("data:") ? body : `data:${mimeFromMessageType(r.type)};base64,${body.replace(/\s/g, "")}`;
      body = labelForMediaType(r.type) || "Mídia";
    } else if (isLikelyBase64Payload(body)) {
      body = labelForMediaType(r.type) || body.slice(0, 40);
    }
    return {
      id: r.id,
      body,
      fromMe: r.fromMe,
      timestamp: r.timestamp.getTime(),
      type: r.type,
      mediaUrl
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
  const event = String(body.event ?? body.type ?? "").toLowerCase();
  if (event && !/message|onmessage|self/.test(event)) return null;

  const fromMe = body.fromMe === true || body.fromMe === "true";
  const type = String(body.type ?? "chat");

  let chatId =
    extractWaId(body.chatId) ||
    extractWaId((body.chat as Record<string, unknown> | undefined)?.id);

  if (!chatId || !chatId.includes("@g.us")) {
    if (fromMe) {
      chatId =
        extractWaId(body.to) ||
        extractWaId(body.chatId) ||
        extractWaId(body.from) ||
        chatId;
    } else {
      chatId =
        extractWaId(body.chatId) ||
        extractWaId(body.from) ||
        extractWaId(body.to) ||
        chatId;
    }
  }

  if (!chatId || chatId.includes("status@broadcast")) return null;

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
