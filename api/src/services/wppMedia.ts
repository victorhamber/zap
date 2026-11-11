import * as wpp from "./whatsapp/index.js";
import { persistInboundMedia } from "./mediaConvert.js";
import { thumbnailDataUrl } from "./wahaWebhook.js";

const MEDIA_TYPES = new Set(["image", "video", "audio", "ptt", "sticker", "document"]);

export function isInboundMediaType(type: string): boolean {
  return MEDIA_TYPES.has(type.toLowerCase());
}

async function persistWahaUrl(url: string): Promise<string | null> {
  const saved = await wpp.saveRemoteMedia(url);
  if (!saved) return null;
  return persistInboundMedia(saved.dataUrl, saved.mime);
}

/** Grava só o jpeg pequeno do WhatsApp. O vídeo/áudio inteiro continua no Baixar. */
export async function persistGroupPreview(payload: Record<string, unknown>): Promise<string | null> {
  const dataUrl = thumbnailDataUrl(payload);
  if (!dataUrl) return null;
  try {
    return await persistInboundMedia(dataUrl, "image/jpeg");
  } catch {
    return null;
  }
}

export function previewStillNeedsFile(type: string, url: string): boolean {
  if (type !== "video" && type !== "audio") return false;
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  return path.startsWith("data:image/") || /\.(jpe?g|png|webp)$/.test(path);
}

export async function persistRemoteMediaUrl(url: string): Promise<string | null> {
  try {
    return await persistWahaUrl(url);
  } catch {
    return null;
  }
}

export async function downloadMediaForStoredMessage(params: {
  chatId: string;
  waMessageId: string;
  type: string;
  aroundMs?: number;
}): Promise<string | null> {
  if (!isInboundMediaType(params.type)) return null;
  try {
    const url = await wpp.mediaUrlForMessage(params.chatId, params.waMessageId, params.aroundMs ?? 0);
    if (!url) return null;
    return await persistWahaUrl(url);
  } catch {
    return null;
  }
}

/** Baixa mídia recebida pelo webhook do WAHA. */
export async function downloadInboundMedia(
  webhookBody: Record<string, unknown>,
  waMessageId: string | null,
  payload?: Record<string, unknown>
): Promise<string | null> {
  const source = payload ?? webhookBody;
  const media = source.media;
  const direct =
    media && typeof media === "object" ? (media as Record<string, unknown>).url : undefined;
  if (typeof direct === "string" && direct) {
    try {
      return await persistWahaUrl(direct);
    } catch {
      return null;
    }
  }
  const chatId = String(source.from ?? source.chatId ?? "");
  if (!waMessageId || !chatId) return null;
  return downloadMediaForStoredMessage({
    chatId,
    waMessageId,
    type: String(source.type ?? "document")
  });
}
