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

/** Lê display_text/url de buttonParamsJSON (nativeFlow / CTA da API oficial). */
function labelsFromParamsJson(raw: unknown): { label: string; url?: string } | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const label = String(p.display_text ?? p.displayText ?? "").trim();
    const url = String(p.url ?? "").trim() || undefined;
    if (!label && !url) return null;
    return { label: label || "Botão", url };
  } catch {
    return null;
  }
}

/** Rótulos legíveis dos botões (URL, resposta rápida, ligar, fluxo nativo). */
function buttonLabels(buttons: unknown): string[] {
  if (!Array.isArray(buttons)) return [];
  const out: string[] = [];
  for (const b of buttons) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, any>;
    const fromJson = labelsFromParamsJson(o.buttonParamsJSON);
    const label =
      o.buttonText?.displayText ??
      o.quickReplyButton?.displayText ??
      o.urlButton?.displayText ??
      o.callButton?.displayText ??
      o.displayText ??
      fromJson?.label ??
      "";
    const url = o.urlButton?.url ?? o.url ?? fromJson?.url;
    const clean = String(label).trim();
    // Evita gravar só o nome interno do fluxo (cta_url, quick_reply…).
    if (clean && !/^(cta_|quick_reply|call_|copy_code)/i.test(clean)) {
      out.push(url ? `${clean} → ${url}` : clean);
    } else if (url) {
      out.push(url);
    }
  }
  return out;
}

/** Junta título/corpo/rodapé + botões numa string legível para o inbox. */
function composeButtonText(parts: unknown[], buttons: string[], fallback: string): string {
  const body = parts
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join("\n");
  const btns = buttons.map((b) => `▸ ${b}`).join("\n");
  return [body, btns].filter(Boolean).join("\n").trim() || fallback;
}

function parseMessageContent(
  msg: Record<string, unknown>,
  payload?: Record<string, unknown>,
  depth = 0
): { text: string; type: string } {
  // Wrappers que aninham a mensagem real — desembrulha antes de tudo.
  if (depth < 4) {
    const wrapped =
      (msg.ephemeralMessage as Record<string, unknown> | undefined)?.message ??
      (msg.viewOnceMessage as Record<string, unknown> | undefined)?.message ??
      (msg.viewOnceMessageV2 as Record<string, unknown> | undefined)?.message ??
      (msg.viewOnceMessageV2Extension as Record<string, unknown> | undefined)?.message ??
      (msg.documentWithCaptionMessage as Record<string, unknown> | undefined)?.message ??
      (msg.editedMessage as Record<string, unknown> | undefined)?.message;
    if (wrapped && typeof wrapped === "object") {
      return parseMessageContent(wrapped as Record<string, unknown>, payload, depth + 1);
    }
  }

  if (typeof msg.conversation === "string" && msg.conversation.trim()) {
    return { text: msg.conversation.trim(), type: "chat" };
  }
  if (msg.extendedTextMessage && typeof msg.extendedTextMessage === "object") {
    const ext = msg.extendedTextMessage as Record<string, unknown>;
    return { text: String(ext.text ?? "").trim(), type: "chat" };
  }

  // Mensagens com BOTÃO / template / lista / interativas (API oficial).
  // Sem isto, caíam no fallback vazio e eram DESCARTADAS (nunca gravadas).
  if (msg.templateMessage && typeof msg.templateMessage === "object") {
    const tm = msg.templateMessage as Record<string, any>;
    const h = tm.hydratedTemplate ?? tm.hydratedFourRowTemplate ?? tm.fourRowTemplate ?? {};
    return {
      text: composeButtonText(
        [h.hydratedTitleText, h.hydratedContentText, h.hydratedFooterText],
        buttonLabels(h.hydratedButtons),
        "📄 Mensagem com botões"
      ),
      type: "chat"
    };
  }
  if (msg.buttonsMessage && typeof msg.buttonsMessage === "object") {
    const bm = msg.buttonsMessage as Record<string, any>;
    return {
      text: composeButtonText(
        [bm.contentText ?? bm.text, bm.footerText],
        buttonLabels(bm.buttons),
        "📄 Mensagem com botões"
      ),
      type: "chat"
    };
  }
  if (msg.interactiveMessage && typeof msg.interactiveMessage === "object") {
    const im = msg.interactiveMessage as Record<string, any>;
    const buttons = [
      ...buttonLabels(im.nativeFlowMessage?.buttons),
      ...buttonLabels(im.buttonMessage?.buttons),
      ...buttonLabels(im.buttons)
    ];
    return {
      text: composeButtonText(
        [im.header?.title, im.body?.text, im.footer?.text],
        buttons,
        "📄 Mensagem interativa"
      ),
      type: "chat"
    };
  }
  if (msg.listMessage && typeof msg.listMessage === "object") {
    const lm = msg.listMessage as Record<string, any>;
    const rows: string[] = [];
    if (Array.isArray(lm.sections)) {
      for (const sec of lm.sections) {
        if (!sec || typeof sec !== "object") continue;
        for (const row of (sec as Record<string, any>).rows ?? []) {
          const title = String(row?.title ?? "").trim();
          if (title) rows.push(title);
        }
      }
    }
    return {
      text: composeButtonText(
        [lm.title, lm.description, lm.footerText],
        [...(lm.buttonText ? [String(lm.buttonText)] : []), ...rows.slice(0, 8)],
        "📋 Lista"
      ),
      type: "chat"
    };
  }
  // Nome antigo em alguns builds Baileys / Evolution.
  if (msg.highlyStructuredMessage && typeof msg.highlyStructuredMessage === "object") {
    const hs = msg.highlyStructuredMessage as Record<string, any>;
    const text = String(hs.hydratedHsm?.hydratedContentText ?? hs.hydratedHsm?.hydratedTitleText ?? "").trim();
    return {
      text: composeButtonText(
        [text],
        buttonLabels(hs.hydratedHsm?.hydratedButtons),
        "📄 Mensagem com botões"
      ),
      type: "chat"
    };
  }
  // Respostas do cliente a botões/listas.
  if (msg.templateButtonReplyMessage && typeof msg.templateButtonReplyMessage === "object") {
    const r = msg.templateButtonReplyMessage as Record<string, any>;
    return { text: String(r.selectedDisplayText ?? r.selectedId ?? "").trim() || "Resposta de botão", type: "chat" };
  }
  if (msg.buttonsResponseMessage && typeof msg.buttonsResponseMessage === "object") {
    const r = msg.buttonsResponseMessage as Record<string, any>;
    return {
      text: String(r.selectedDisplayText ?? r.selectedButtonId ?? "").trim() || "Resposta de botão",
      type: "chat"
    };
  }
  if (msg.listResponseMessage && typeof msg.listResponseMessage === "object") {
    const r = msg.listResponseMessage as Record<string, any>;
    return {
      text: String(r.title ?? r.singleSelectReply?.selectedRowId ?? "").trim() || "Resposta de lista",
      type: "chat"
    };
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
