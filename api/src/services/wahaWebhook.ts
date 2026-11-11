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

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function typeFromMime(mime: string): string | null {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return m.includes("ogg") ? "ptt" : "audio";
  return null;
}

function typeFromName(name: string): string | null {
  const n = name.toLowerCase().split("?")[0] ?? "";
  if (/\.(jpe?g|png|gif|webp)$/.test(n)) return "image";
  if (/\.(mp4|mov|webm)$/.test(n)) return "video";
  if (/\.(ogg|mp3|m4a|opus)$/.test(n)) return "audio";
  return null;
}

function mediaType(payload: Record<string, unknown>): string {
  const media = asRecord(payload.media);
  const mime = textOf(media?.mimetype ?? payload.mimetype ?? payload.mimeType);
  const fromMime = typeFromMime(mime);
  if (fromMime) return fromMime;
  const filename = textOf(media?.filename ?? payload.filename);
  const fromName = typeFromName(filename) ?? typeFromName(textOf(media?.url));
  if (fromName) return fromName;
  const declared = textOf(payload.type).toLowerCase();
  if (declared === "image" || declared === "sticker" || declared === "video" || declared === "audio" || declared === "ptt" || declared === "document") {
    return declared;
  }
  if (payload.hasMedia === true) return "document";
  return "chat";
}

function mediaUrlOf(payload: Record<string, unknown>): string | null {
  const media = asRecord(payload.media);
  const url = textOf(media?.url).trim();
  return url || null;
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
    mediaUrl: mediaUrlOf(payload),
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
