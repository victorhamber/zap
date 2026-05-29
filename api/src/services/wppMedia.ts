import { env } from "../env.js";
import * as wpp from "./whatsapp/index.js";
import { persistInboundMedia } from "./mediaConvert.js";
import { normalizeWppWebhookBody } from "./wppWebhook.js";

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

function serializedMessageId(body: Record<string, unknown>): string | null {
  const idField = body.id;
  if (typeof idField === "string" && idField.includes("@")) return idField;
  if (idField && typeof idField === "object") {
    const o = idField as Record<string, unknown>;
    const s = String(o._serialized ?? o.id ?? "");
    if (s.includes("@")) return s;
  }
  return null;
}

/** Baixa mídia criptografada (WPPConnect ou Evolution). */
export async function downloadInboundMedia(
  webhookBody: Record<string, unknown>,
  waMessageId: string | null,
  evolutionPayload?: Record<string, unknown>
): Promise<string | null> {
  if (env.WHATSAPP_PROVIDER === "evolution") {
    const payload =
      evolutionPayload ??
      (Array.isArray(webhookBody.data)
        ? (webhookBody.data[0] as Record<string, unknown>)
        : (webhookBody.data as Record<string, unknown> | undefined));
    if (!payload || typeof payload !== "object") return null;
    try {
      const { downloadEvolutionInboundMedia } = await import("./whatsapp/evolution.js");
      const raw = await downloadEvolutionInboundMedia(payload);
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

  const normalized = normalizeWppWebhookBody(webhookBody);
  const type = String(normalized.type ?? "").toLowerCase();
  if (!isInboundMediaType(type)) return null;

  const serializedId = waMessageId ?? serializedMessageId(normalized);
  if (!serializedId) return null;

  const hasFullMessage =
    Boolean(normalized.from || normalized.chatId) &&
    (normalized.isMedia === true ||
      normalized.isMMS === true ||
      Boolean(normalized.mimetype ?? normalized.mimeType));

  try {
    const messageId = hasFullMessage ? normalized : serializedId;
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
    try {
      const encoded = encodeURIComponent(serializedId);
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
