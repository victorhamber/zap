/** Parser de webhooks Evolution API v2 (MESSAGES_UPSERT, etc.) */
import { extractWaId } from "../inbox.js";
import { mimeFromMessageType } from "../mediaText.js";
import { canonicalEvolutionChatId, normalizeDirectJid } from "../waJid.js";

export function getEvolutionWebhookEvent(body: Record<string, unknown>): string {
  return String(body.event ?? body.type ?? "").toLowerCase();
}

export function isEvolutionMessageEvent(body: Record<string, unknown>): boolean {
  const ev = getEvolutionWebhookEvent(body);
  return (
    ev === "messages.upsert" ||
    ev === "messages_upsert" ||
    ev === "send.message" ||
    ev === "send_message"
  );
}

function parseMessageContent(
  msg: Record<string, unknown>,
  payload?: Record<string, unknown>
): { text: string; type: string } {
  if (typeof msg.conversation === "string" && msg.conversation.trim()) {
    return { text: msg.conversation.trim(), type: "chat" };
  }
  if (msg.extendedTextMessage && typeof msg.extendedTextMessage === "object") {
    const ext = msg.extendedTextMessage as Record<string, unknown>;
    return { text: String(ext.text ?? "").trim(), type: "chat" };
  }
  if (msg.imageMessage) {
    const im = msg.imageMessage as Record<string, unknown>;
    return { text: String(im.caption ?? "").trim(), type: "image" };
  }
  if (msg.videoMessage) {
    const vm = msg.videoMessage as Record<string, unknown>;
    return { text: String(vm.caption ?? "").trim(), type: "video" };
  }
  if (msg.audioMessage) return { text: "", type: "audio" };
  if (msg.pttMessage) return { text: "", type: "ptt" };
  if (msg.documentMessage) {
    const dm = msg.documentMessage as Record<string, unknown>;
    return {
      text: String(dm.caption ?? dm.fileName ?? "📎 Documento").trim(),
      type: "document"
    };
  }
  if (msg.stickerMessage) return { text: "", type: "sticker" };
  if (msg.locationMessage) return { text: "📍 Localização", type: "location" };

  const payloadType = String(payload?.messageType ?? "").toLowerCase();
  if (payloadType.includes("audio")) return { text: "", type: "audio" };
  if (payloadType.includes("image")) return { text: "", type: "image" };
  if (payloadType.includes("video")) return { text: "", type: "video" };
  if (payloadType.includes("document")) return { text: "📎 Documento", type: "document" };
  if (payloadType.includes("sticker")) return { text: "", type: "sticker" };

  return { text: "", type: "chat" };
}

function inlineMediaFromPayload(
  payload: Record<string, unknown>,
  msg: Record<string, unknown>,
  type: string
): string | null {
  const mime = mimeFromMessageType(type === "ptt" ? "audio" : type);
  const candidates = [
    payload.base64,
    msg.base64,
    (payload.message as Record<string, unknown> | undefined)?.base64
  ];
  for (const raw of candidates) {
    if (typeof raw !== "string" || raw.length < 32) continue;
    const b64 = raw.replace(/\s/g, "");
    if (b64.startsWith("data:")) return b64;
    return `data:${mime};base64,${b64}`;
  }
  return null;
}

/** Um ou mais payloads `data` do webhook Evolution. */
export function extractEvolutionMessagePayloads(body: Record<string, unknown>): Record<string, unknown>[] {
  const data = body.data;
  if (Array.isArray(data)) {
    return data.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  }
  if (data && typeof data === "object") return [data as Record<string, unknown>];
  return [];
}

export function parseEvolutionInboundMessage(
  body: Record<string, unknown>
): {
  instance: string;
  chatId: string;
  text: string;
  fromMe: boolean;
  type: string;
  mediaUrl: string | null;
  waMessageId: string | null;
  timestamp: Date;
  rawData: Record<string, unknown>;
} | null {
  const payloads = extractEvolutionMessagePayloads(body);
  if (payloads.length === 0) return null;
  return parseEvolutionMessagePayload(body, payloads[0]);
}

export function parseEvolutionMessagePayload(
  body: Record<string, unknown>,
  payload: Record<string, unknown>
): {
  instance: string;
  chatId: string;
  text: string;
  fromMe: boolean;
  type: string;
  mediaUrl: string | null;
  waMessageId: string | null;
  timestamp: Date;
  rawData: Record<string, unknown>;
} | null {
  if (!isEvolutionMessageEvent(body)) return null;

  const instance = String(body.instance ?? "").trim().toLowerCase();
  const key = (payload.key ?? {}) as Record<string, unknown>;
  const remoteJid = String(key.remoteJid ?? key.remotejid ?? "").trim();
  if (!remoteJid || remoteJid.includes("status@broadcast")) return null;

  const fromMe = key.fromMe === true || key.fromMe === "true";
  const peer = canonicalEvolutionChatId(key, payload);
  const chatId = normalizeDirectJid(extractWaId(peer) || peer);
  if (!chatId) return null;

  const msg = (payload.message ?? {}) as Record<string, unknown>;
  const { text, type } = parseMessageContent(msg, payload);

  const mediaTypes = new Set(["image", "video", "audio", "ptt", "sticker", "document"]);
  if (type === "chat" && !text.trim()) return null;
  if (!text.trim() && !mediaTypes.has(type)) return null;

  const waMessageId = String(key.id ?? payload.id ?? "").trim() || null;

  let ts = Date.now();
  const rawTs = payload.messageTimestamp ?? payload.timestamp ?? key.timestamp;
  if (typeof rawTs === "number") {
    ts = rawTs > 1e12 ? rawTs : rawTs * 1000;
  }

  const mediaUrl = inlineMediaFromPayload(payload, msg, type);

  return {
    instance,
    chatId,
    text,
    fromMe,
    type,
    mediaUrl,
    waMessageId,
    timestamp: new Date(ts),
    rawData: payload
  };
}

export function parseEvolutionConnectionEvent(body: Record<string, unknown>): string | null {
  const ev = getEvolutionWebhookEvent(body);
  if (ev !== "connection.update" && ev !== "connection_update") return null;
  const data = body.data;
  if (data && typeof data === "object") {
    const state = String((data as Record<string, unknown>).state ?? "").toLowerCase();
    if (state === "open") return "CONNECTED:open";
    if (state === "close") return "DISCONNECTED:close";
    if (state === "connecting") return "CONNECTING";
  }
  return "CONNECTION_UPDATE";
}

export function extractEvolutionQr(body: Record<string, unknown>): string | null {
  const ev = getEvolutionWebhookEvent(body);
  if (ev !== "qrcode.updated" && ev !== "qrcode_updated") return null;
  const data = body.data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const qrcode = d.qrcode ?? d.qrCode ?? d.base64;
  if (typeof qrcode === "string" && qrcode.length > 50) {
    return qrcode.startsWith("data:") ? qrcode : `data:image/png;base64,${qrcode}`;
  }
  return null;
}
