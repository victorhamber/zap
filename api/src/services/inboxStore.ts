import { prisma } from "../prisma.js";
import { extractWaId, type NormalizedMessage } from "./inbox.js";

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

function messageBodyFromType(type: string, text: string): string {
  if (text.trim()) return text.trim();
  if (type === "image" || type === "sticker") return "📷 Imagem";
  if (type === "video") return "🎬 Vídeo";
  if (type === "audio" || type === "ptt") return "🎤 Áudio";
  if (type === "document") return "📎 Documento";
  if (type === "location") return "📍 Localização";
  return "";
}

export async function saveInboxMessage(params: {
  chatId: string;
  body: string;
  fromMe: boolean;
  type?: string;
  waMessageId?: string | null;
  timestamp?: Date;
}): Promise<void> {
  if (!prisma) return;

  const session = await getSessionName();
  const chatId = extractWaId(params.chatId) || params.chatId.trim();
  if (!chatId || chatId.includes("status@broadcast")) return;

  const type = params.type ?? "chat";
  const body = messageBodyFromType(type, params.body);
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

  const messages: NormalizedMessage[] = rows.map((r) => ({
    id: r.id,
    body: r.body,
    fromMe: r.fromMe,
    timestamp: r.timestamp.getTime(),
    type: r.type
  }));

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

  return {
    chatId,
    text,
    fromMe,
    type,
    waMessageId: waMessageId || null,
    timestamp: new Date(ts)
  };
}
