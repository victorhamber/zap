import { findInstanceByPhoneNumberId, findInstanceByMetaWebhookToken } from "./wppInstanceConfig.js";
import { extractMetaTemplateComponents } from "./templateText.js";

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

function joinParts(parts: unknown[]): string {
  return parts
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function parseMetaMessageType(msg: Record<string, unknown>): { type: string; text: string } {
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

  // Templates / botões / listas (API Cloud) — sem isto o texto vinha vazio e a msg sumia.
  if (t === "button") {
    const btn = (msg.button as Record<string, unknown> | undefined) ?? {};
    const text = String(btn.text ?? btn.payload ?? "").trim();
    return { type: "chat", text: text || "Resposta de botão" };
  }
  if (t === "interactive") {
    const inter = (msg.interactive as Record<string, unknown> | undefined) ?? {};
    const kind = String(inter.type ?? "").toLowerCase();
    if (kind === "button_reply") {
      const br = (inter.button_reply as Record<string, unknown> | undefined) ?? {};
      return { type: "chat", text: String(br.title ?? br.id ?? "").trim() || "Resposta de botão" };
    }
    if (kind === "list_reply") {
      const lr = (inter.list_reply as Record<string, unknown> | undefined) ?? {};
      return {
        type: "chat",
        text: joinParts([lr.title, lr.description]) || "Resposta de lista"
      };
    }
    if (kind === "nfm_reply") {
      const nfm = (inter.nfm_reply as Record<string, unknown> | undefined) ?? {};
      return {
        type: "chat",
        text: String(nfm.body ?? nfm.name ?? "").trim() || "Resposta de fluxo"
      };
    }
    const body = (inter.body as Record<string, unknown> | undefined)?.text;
    const header = (inter.header as Record<string, unknown> | undefined)?.text;
    const footer = (inter.footer as Record<string, unknown> | undefined)?.text;
    const action = (inter.action as Record<string, unknown> | undefined) ?? {};
    const labels: string[] = [];
    if (Array.isArray(action.buttons)) {
      for (const b of action.buttons) {
        if (!b || typeof b !== "object") continue;
        const title = String(
          ((b as Record<string, unknown>).reply as Record<string, unknown> | undefined)?.title ?? ""
        ).trim();
        if (title) labels.push(`▸ ${title}`);
      }
    }
    if (typeof action.button === "string" && action.button.trim()) {
      labels.push(`▸ ${action.button.trim()}`);
    }
    const text = joinParts([header, body, footer, ...labels]);
    return { type: "chat", text: text || "📄 Mensagem interativa" };
  }
  if (t === "template") {
    const tpl = (msg.template as Record<string, unknown> | undefined) ?? {};
    const name = String(tpl.name ?? "").trim();
    const { parts, buttons } = extractMetaTemplateComponents(tpl.components);
    const buttonLines = buttons.map((b) => `▸ ${b}`);
    const text = joinParts([...parts, ...buttonLines]);
    return {
      type: "chat",
      text: text || (name ? `📄 Template: ${name}` : "📄 Mensagem com botões")
    };
  }

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
      const field = String(c.field ?? "");
      // "messages" = recebidas; echoes = enviadas via Cloud API (outro sistema,
      // app WhatsApp Business etc.). Sem os echoes, tudo que é enviado pela API
      // oficial nunca era salvo e a conversa ficava sem essas mensagens.
      const isEcho = field === "smb_message_echoes" || field === "message_echoes";
      if (field !== "messages" && !isEcho) continue;
      const value = c.value as Record<string, unknown> | undefined;
      if (!value) continue;

      const phoneNumberId = String(
        (value.metadata as Record<string, unknown> | undefined)?.phone_number_id ?? ""
      ).trim();
      if (!phoneNumberId) continue;

      const session = await findInstanceByPhoneNumberId(phoneNumberId);
      if (!session) continue;

      const list = isEcho
        ? Array.isArray(value.message_echoes)
          ? value.message_echoes
          : Array.isArray(value.messages)
            ? value.messages
            : []
        : Array.isArray(value.messages)
          ? value.messages
          : [];

      for (const raw of list) {
        if (!raw || typeof raw !== "object") continue;
        const msg = raw as Record<string, unknown>;
        // Echo: a conversa é com o destinatário (to); recebida: com o remetente (from).
        const peer = isEcho
          ? String(msg.to ?? msg.recipient_id ?? "").replace(/\D/g, "")
          : String(msg.from ?? "").replace(/\D/g, "");
        if (!peer) continue;

        const { type, text } = parseMetaMessageType(msg);
        // Sem texto útil (ex.: tipos desconhecidos) — não grava bolha vazia.
        if (!text.trim()) continue;
        const ts = Number(msg.timestamp ?? 0);
        const waMessageId = String(msg.id ?? "").trim();
        if (!waMessageId) continue;

        out.push({
          session,
          chatId: chatIdFromPhone(peer),
          text,
          fromMe: isEcho,
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
