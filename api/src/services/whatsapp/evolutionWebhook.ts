/** Parser de webhooks Evolution API v2 (MESSAGES_UPSERT, etc.) */

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

export function parseEvolutionInboundMessage(
  body: Record<string, unknown>
): {
  instance: string;
  chatId: string;
  text: string;
  fromMe: boolean;
  type: string;
  waMessageId: string | null;
  timestamp: Date;
} | null {
  if (!isEvolutionMessageEvent(body)) return null;

  const instance = String(body.instance ?? "").trim().toLowerCase();
  const data = body.data;
  if (!data || typeof data !== "object") return null;

  const d = data as Record<string, unknown>;
  const key = (d.key ?? {}) as Record<string, unknown>;
  const remoteJid = String(key.remoteJid ?? key.remotejid ?? "").trim();
  if (!remoteJid || remoteJid.includes("status@broadcast")) return null;

  const fromMe = key.fromMe === true || key.fromMe === "true";
  const msg = (d.message ?? {}) as Record<string, unknown>;

  let text = "";
  let type = "chat";
  if (typeof msg.conversation === "string") text = msg.conversation;
  else if (msg.extendedTextMessage && typeof msg.extendedTextMessage === "object") {
    const ext = msg.extendedTextMessage as Record<string, unknown>;
    text = String(ext.text ?? "");
    type = "chat";
  } else if (msg.imageMessage) {
    type = "image";
    text = String((msg.imageMessage as Record<string, unknown>).caption ?? "");
  } else if (msg.videoMessage) {
    type = "video";
    text = String((msg.videoMessage as Record<string, unknown>).caption ?? "");
  } else if (msg.audioMessage || msg.pttMessage) {
    type = "audio";
  } else if (msg.documentMessage) {
    type = "document";
    text = String((msg.documentMessage as Record<string, unknown>).caption ?? "📎 Documento");
  } else if (msg.stickerMessage) {
    type = "sticker";
  }

  const waMessageId = String(key.id ?? d.id ?? "").trim() || null;

  let ts = Date.now();
  const rawTs = d.messageTimestamp ?? d.timestamp;
  if (typeof rawTs === "number") {
    ts = rawTs > 1e12 ? rawTs : rawTs * 1000;
  }

  return {
    instance,
    chatId: remoteJid,
    text,
    fromMe,
    type,
    waMessageId,
    timestamp: new Date(ts)
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
