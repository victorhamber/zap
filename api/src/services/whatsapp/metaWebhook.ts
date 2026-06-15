import { findInstanceByPhoneNumberId, findInstanceByMetaWebhookToken } from "./wppInstanceConfig.js";

export type MetaParsedMessage = {
  session: string;
  chatId: string;
  text: string;
  fromMe: boolean;
  type: string;
  waMessageId: string;
  timestamp: Date;
  phoneNumberId: string;
};

function chatIdFromPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

function parseMessageType(msg: Record<string, unknown>): { type: string; text: string } {
  const t = String(msg.type ?? "text").toLowerCase();
  if (t === "text") {
    const body = (msg.text as Record<string, unknown> | undefined)?.body;
    return { type: "chat", text: String(body ?? "").trim() };
  }
  if (t === "image") {
    const cap = (msg.image as Record<string, unknown> | undefined)?.caption;
    return { type: "image", text: String(cap ?? "").trim() || "📷 Imagem" };
  }
  if (t === "audio") return { type: "audio", text: "🎤 Áudio" };
  if (t === "video") {
    const cap = (msg.video as Record<string, unknown> | undefined)?.caption;
    return { type: "video", text: String(cap ?? "").trim() || "🎬 Vídeo" };
  }
  if (t === "document") {
    const cap = (msg.document as Record<string, unknown> | undefined)?.caption;
    const fn = (msg.document as Record<string, unknown> | undefined)?.filename;
    return { type: "document", text: String(cap ?? fn ?? "📎 Documento").trim() };
  }
  if (t === "sticker") return { type: "sticker", text: "Sticker" };
  if (t === "location") return { type: "location", text: "📍 Localização" };
  return { type: t, text: "" };
}

export async function verifyMetaWebhookChallenge(query: Record<string, unknown>): Promise<string | null> {
  const mode = String(query["hub.mode"] ?? "");
  const token = String(query["hub.verify_token"] ?? "");
  const challenge = String(query["hub.challenge"] ?? "");
  if (mode !== "subscribe" || !token || !challenge) return null;

  const instance = await findInstanceByMetaWebhookToken(token);
  if (!instance) return null;
  return challenge;
}

export async function parseMetaWebhookMessages(
  body: Record<string, unknown>
): Promise<MetaParsedMessage[]> {
  if (String(body.object ?? "") !== "whatsapp_business_account") return [];

  const out: MetaParsedMessage[] = [];
  const entries = Array.isArray(body.entry) ? body.entry : [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const changes = Array.isArray((entry as Record<string, unknown>).changes)
      ? ((entry as Record<string, unknown>).changes as unknown[])
      : [];

    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const c = change as Record<string, unknown>;
      if (String(c.field ?? "") !== "messages") continue;
      const value = c.value as Record<string, unknown> | undefined;
      if (!value) continue;

      const phoneNumberId = String(
        (value.metadata as Record<string, unknown> | undefined)?.phone_number_id ?? ""
      ).trim();
      if (!phoneNumberId) continue;

      const session = await findInstanceByPhoneNumberId(phoneNumberId);
      if (!session) continue;

      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const raw of messages) {
        if (!raw || typeof raw !== "object") continue;
        const msg = raw as Record<string, unknown>;
        const from = String(msg.from ?? "").replace(/\D/g, "");
        if (!from) continue;

        const { type, text } = parseMessageType(msg);
        const ts = Number(msg.timestamp ?? 0);
        const waMessageId = String(msg.id ?? "").trim();
        if (!waMessageId) continue;

        out.push({
          session,
          chatId: chatIdFromPhone(from),
          text,
          fromMe: false,
          type,
          waMessageId,
          timestamp: new Date(ts > 1e12 ? ts : ts * 1000),
          phoneNumberId
        });
      }
    }
  }

  return out;
}
