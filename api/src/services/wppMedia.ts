import * as wpp from "./wppconnect.js";
import { persistInboundMedia } from "./mediaConvert.js";

const MEDIA_TYPES = new Set([
  "image",
  "video",
  "audio",
  "ptt",
  "sticker",
  "document"
]);

export function isInboundMediaType(type: string): boolean {
  return MEDIA_TYPES.has(type.toLowerCase());
}

function extractBase64FromWppResponse(raw: unknown): { base64: string; mime: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const nested =
    o.response && typeof o.response === "object"
      ? (o.response as Record<string, unknown>)
      : o;

  const base64 = String(nested.base64 ?? nested.data ?? "");
  const mime = String(nested.mimetype ?? nested.mimeType ?? "application/octet-stream");
  if (!base64 || base64.length < 32) return null;
  return { base64: base64.replace(/\s/g, ""), mime };
}

/** Baixa mídia criptografada via WPP (mensagens recebidas sem base64 no webhook). */
export async function downloadInboundMedia(
  webhookBody: Record<string, unknown>,
  waMessageId: string | null
): Promise<string | null> {
  const type = String(webhookBody.type ?? "").toLowerCase();
  if (!isInboundMediaType(type)) return null;

  const hasMediaFlag =
    webhookBody.isMedia === true ||
    webhookBody.isMMS === true ||
    Boolean(webhookBody.mimetype ?? webhookBody.mimeType);

  if (!hasMediaFlag && !waMessageId) return null;

  try {
    const messageId =
      hasMediaFlag && typeof webhookBody.type === "string" ? webhookBody : waMessageId;

    if (!messageId) return null;

    const raw = await wpp.callSessionApi("/download-media", "POST", { messageId });
    const parsed = extractBase64FromWppResponse(raw);
    if (!parsed) return null;

    let mime = parsed.mime;
    if (type === "ptt" && !mime.includes("ogg")) {
      mime = "audio/ogg";
    }

    return await persistInboundMedia(
      `data:${mime};base64,${parsed.base64}`,
      mime
    );
  } catch {
    if (!waMessageId) return null;
    try {
      const encoded = encodeURIComponent(waMessageId);
      const raw = await wpp.callSessionApi(`/get-media-by-message/${encoded}`, "GET");
      const parsed = extractBase64FromWppResponse(raw);
      if (!parsed) return null;
      return await persistInboundMedia(
        `data:${parsed.mime};base64,${parsed.base64}`,
        parsed.mime
      );
    } catch {
      return null;
    }
  }
}
