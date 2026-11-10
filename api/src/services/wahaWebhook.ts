export type WahaParsedMessage = {
  chatId: string;
  text: string;
  fromMe: boolean;
  type: string;
  mediaUrl: string | null;
  waMessageId: string | null;
  timestamp: number;
  pushName: string;
  session: string;
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mediaType(payload: Record<string, unknown>): string {
  const media = asRecord(payload.media);
  const mime = String(media?.mimetype ?? payload.mimetype ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return mime.includes("ogg") ? "ptt" : "audio";
  if (payload.hasMedia === true) return "document";
  return "chat";
}

function preview(type: string, body: string): string {
  if (body.trim()) return body;
  if (type === "image") return "📷 Imagem";
  if (type === "video") return "🎬 Vídeo";
  if (type === "audio" || type === "ptt") return "🎤 Áudio";
  if (type === "document") return "📎 Documento";
  return "";
}

export function parseWahaMessage(
  body: Record<string, unknown>,
  payloadInput?: Record<string, unknown>
): WahaParsedMessage | null {
  const event = String(body.event ?? "").toLowerCase();
  const payload = payloadInput ?? asRecord(body.payload);
  if (!payload) return null;
  if (event && event !== "message" && event !== "message.any") return null;

  const from = String(payload.from ?? "");
  const to = String(payload.to ?? "");
  const fromMe = payload.fromMe === true;
  const chatId = fromMe ? to || from : from;
  if (!chatId || chatId === "status@broadcast") return null;

  const type = mediaType(payload);
  const text = preview(type, String(payload.body ?? ""));
  const id = String(payload.id ?? "").trim();
  const rawTs = Number(payload.timestamp ?? 0);
  const timestamp = rawTs > 10_000_000_000 ? rawTs : rawTs > 0 ? rawTs * 1000 : Date.now();
  const info = asRecord(payload._data);
  const pushName = String(payload.notifyName ?? info?.notifyName ?? payload.pushName ?? "").trim();

  return {
    chatId,
    text,
    fromMe,
    type,
    mediaUrl: null,
    waMessageId: id || null,
    timestamp,
    pushName,
    session: String(body.session ?? "").trim().toLowerCase(),
    raw: payload
  };
}

export function wahaSessionStatus(body: Record<string, unknown>): string | null {
  const event = String(body.event ?? "").toLowerCase();
  if (event !== "session.status") return null;
  const payload = asRecord(body.payload);
  const status = String(payload?.status ?? "").toUpperCase();
  return status || null;
}
