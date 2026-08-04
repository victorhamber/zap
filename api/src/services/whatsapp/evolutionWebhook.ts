/** Parser de webhooks Evolution API v2 (MESSAGES_UPSERT, etc.) */
import { extractWaId } from "../inbox.js";
import { mimeFromMessageType } from "../mediaText.js";
import { canonicalEvolutionChatId, normalizeDirectJid } from "../waJid.js";
import { asObjectList, extractMetaTemplateComponents } from "./templateText.js";

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

/** Placeholder que gravamos quando o provedor não manda o texto hidratado. */
export function isButtonPlaceholderBody(body: string): boolean {
  const t = body.replace(/^\uFEFF/, "").trim();
  return (
    /^(📄\s*)?(Mensagem com botões|Mensagem interativa|Lista)$/i.test(t) ||
    /^📄\s*Template:/i.test(t) ||
    /^📄\s*Mensagem interativa/i.test(t) ||
    t.includes("não chega pela Evolution") ||
    t.includes("nao chega pela Evolution")
  );
}

/** Texto padrão quando a Evolution/Baileys não entrega o corpo do template (ex.: Meta→você). */
export const OPAQUE_INTERACTIVE_HINT =
  "📄 Mensagem interativa\nO texto completo não chega pela Evolution (conexão não oficial). Veja no WhatsApp do celular.";

function opaqueInteractiveFallback(opts?: {
  title?: string;
  kind?: string;
  buttons?: string[];
}): string {
  const title = (opts?.title ?? "").trim();
  const kind = (opts?.kind ?? "").trim();
  const head = title
    ? `📄 ${title}`
    : kind
      ? `📄 Mensagem interativa (${kind})`
      : "📄 Mensagem interativa";
  const hint =
    "O texto completo não chega pela Evolution (conexão não oficial). Veja no WhatsApp do celular.";
  const btns = (opts?.buttons ?? []).map((b) => `▸ ${b}`);
  return [head, hint, ...btns].filter(Boolean).join("\n");
}

/** Lê display_text/url de buttonParamsJSON (nativeFlow / CTA da API oficial). */
function labelsFromParamsJson(raw: unknown): { label: string; url?: string } | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const label = String(p.display_text ?? p.displayText ?? p.title ?? "").trim();
    const url = String(p.url ?? p.cta_url ?? "").trim() || undefined;
    if (!label && !url) return null;
    return { label: label || "Botão", url };
  } catch {
    return null;
  }
}

/** Rótulos legíveis dos botões (URL, resposta rápida, ligar, fluxo nativo). */
function buttonLabels(buttons: unknown): string[] {
  const out: string[] = [];
  for (const b of asObjectList(buttons)) {
    const o = b as Record<string, any>;
    const fromJson = labelsFromParamsJson(o.buttonParamsJSON ?? o.buttonParamsJson);
    const label =
      o.buttonText?.displayText ??
      o.quickReplyButton?.displayText ??
      o.urlButton?.displayText ??
      o.callButton?.displayText ??
      o.displayText ??
      o.display_text ??
      fromJson?.label ??
      "";
    const url =
      o.urlButton?.url ?? o.url ?? o.ctaUrl ?? o.cta_url ?? fromJson?.url;
    const clean = String(label).trim();
    // Evita gravar só o nome interno do fluxo (cta_url, quick_reply…).
    if (clean && !/^(cta_|quick_reply|call_|copy_code)/i.test(clean)) {
      out.push(url ? `${clean} → ${url}` : clean);
    } else if (url) {
      out.push(String(url));
    }
  }
  return out;
}

/** Texto/caption embutido em cabeçalho de mídia do template. */
function mediaCaptionFrom(obj: Record<string, any> | null | undefined): string {
  if (!obj || typeof obj !== "object") return "";
  for (const key of ["imageMessage", "videoMessage", "documentMessage", "locationMessage"]) {
    const m = obj[key];
    if (!m || typeof m !== "object") continue;
    const cap = String(m.caption ?? m.fileName ?? m.name ?? "").trim();
    if (cap) return cap;
  }
  return "";
}

/** Campos de texto comuns em hydratedTemplate / buttonsMessage / JSON de fluxo. */
function textFieldsFrom(obj: Record<string, any> | null | undefined): string[] {
  if (!obj || typeof obj !== "object") return [];
  const keys = [
    "hydratedTitleText",
    "hydratedContentText",
    "hydratedFooterText",
    "contentText",
    "footerText",
    "text",
    "title",
    "subtitle",
    "body",
    "description",
    "caption",
    "name",
    "displayName",
    "productTitle",
    "businessOwnerJid",
    "inviteCode",
    "inviteMessage"
  ];
  const out: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) out.push(v.trim());
    else if (v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string") {
      const t = String((v as { text: string }).text).trim();
      if (t) out.push(t);
    }
  }
  const mediaCap = mediaCaptionFrom(obj);
  if (mediaCap) out.push(mediaCap);
  return out;
}

/**
 * Varredura profunda: Meta/Facebook às vezes manda o texto em campos aninhados
 * que o parser tipado não cobre. Coleta strings “legíveis” e rótulos de botão.
 */
function deepHarvestInteractive(root: unknown, depth = 0): { parts: string[]; buttons: string[] } {
  const parts: string[] = [];
  const buttons: string[] = [];
  if (root == null || depth > 8) return { parts, buttons };

  if (typeof root === "string") {
    const t = root.trim();
    if (
      t.length >= 2 &&
      t.length <= 500 &&
      !/^(true|false|null|undefined)$/i.test(t) &&
      !/^[A-Za-z0-9+/=]{40,}$/.test(t) &&
      !/^data:/.test(t) &&
      !/^[0-9a-f-]{20,}$/i.test(t) &&
      !/@(s\.whatsapp\.net|c\.us|g\.us|lid)$/i.test(t)
    ) {
      parts.push(t);
    }
    const fromJson = labelsFromParamsJson(t);
    if (fromJson) {
      buttons.push(fromJson.url ? `${fromJson.label} → ${fromJson.url}` : fromJson.label);
    } else {
      try {
        const parsed = JSON.parse(t);
        const nested = deepHarvestInteractive(parsed, depth + 1);
        parts.push(...nested.parts);
        buttons.push(...nested.buttons);
      } catch {
        /* not json */
      }
    }
    return { parts, buttons };
  }

  if (Array.isArray(root)) {
    for (const item of root) {
      const nested = deepHarvestInteractive(item, depth + 1);
      parts.push(...nested.parts);
      buttons.push(...nested.buttons);
    }
    return { parts, buttons };
  }

  if (typeof root !== "object") return { parts, buttons };
  const o = root as Record<string, any>;

  // Preferência: campos tipados de UI
  parts.push(...textFieldsFrom(o));
  buttons.push(...buttonLabels(o.hydratedButtons ?? o.buttons ?? o.templateButtons));

  const interestingKeys = new Set([
    "hydratedTemplate",
    "hydratedFourRowTemplate",
    "fourRowTemplate",
    "hydratedHsm",
    "nativeFlowMessage",
    "buttonMessage",
    "carouselMessage",
    "header",
    "body",
    "footer",
    "interactiveMessage",
    "templateMessage",
    "buttonsMessage",
    "listMessage",
    "highlyStructuredMessage",
    "productMessage",
    "orderMessage",
    "groupInviteMessage",
    "newsletterAdminInviteMessage",
    "externalAdReply",
    "hydratedButtons",
    "buttons",
    "sections",
    "rows",
    "cards",
    "action",
    "parameters",
    "components"
  ]);

  for (const [k, v] of Object.entries(o)) {
    if (k === "key" || k === "messageContextInfo" || k === "deviceListMetadata") continue;
    if (interestingKeys.has(k) || depth <= 2) {
      const nested = deepHarvestInteractive(v, depth + 1);
      parts.push(...nested.parts);
      buttons.push(...nested.buttons);
    }
  }

  return { parts, buttons };
}

function uniqKeepOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** messageParamsJson do nativeFlow às vezes carrega título/corpo inteiros. */
function textsFromParamsJson(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const p = JSON.parse(raw) as Record<string, any>;
    return textFieldsFrom(p);
  } catch {
    return [];
  }
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

/** Echo da Evolution ao enviar template oficial: `▶️nome_do_template◀️`. */
function textFromEvolutionTemplateEcho(raw: string): string | null {
  const m = raw.trim().match(/^▶️\s*(.+?)\s*◀️$/);
  if (!m?.[1]) return null;
  return `📄 Template: ${m[1].trim()}`;
}

function coerceMessageObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

/**
 * Evolution/Baileys mandam timestamp como number, string numérica ou Long `{ low, high }`.
 * Se cair em Date.now(), o sync grava um horário "agora" e o webhook outro — mídia duplica.
 */
export function parseWhatsAppTimestamp(raw: unknown): number {
  const now = Date.now();
  if (raw == null || raw === "") return now;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000;
  }

  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return now;
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
    }
    const parsed = Date.parse(t);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    // protobuf Long / BSON-ish
    if (typeof o.low === "number") {
      const low = o.low >>> 0;
      const high = typeof o.high === "number" ? o.high : 0;
      const seconds = high * 2 ** 32 + low;
      if (seconds > 0) return seconds > 1e12 ? seconds : seconds * 1000;
    }
    if (typeof o.seconds === "number") {
      return o.seconds > 1e12 ? o.seconds : o.seconds * 1000;
    }
    if (typeof o.toNumber === "function") {
      try {
        const n = (o as { toNumber: () => number }).toNumber();
        if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
      } catch {
        /* ignore */
      }
    }
  }

  return now;
}

function extractTemplateLikeText(
  container: Record<string, any>,
  buttonsSource: unknown,
  fallback: string
): string {
  const meta = extractMetaTemplateComponents(container.components);
  const templateName = String(container.name ?? "").trim();
  const deep = deepHarvestInteractive(container);
  const fieldParts = textFieldsFrom(container).filter((p) => p !== templateName);
  const parts = uniqKeepOrder([
    ...fieldParts,
    ...textsFromParamsJson(container.messageParamsJson ?? container.messageParamsJSON),
    ...meta.parts,
    ...deep.parts.filter((p) => p !== templateName && !/^📄/.test(p))
  ]);
  const buttons = uniqKeepOrder([
    ...buttonLabels(buttonsSource ?? container.hydratedButtons ?? container.buttons),
    ...meta.buttons,
    ...deep.buttons
  ]);
  const composed = composeButtonText(parts, buttons, "");
  if (composed && !isButtonPlaceholderBody(composed)) return composed;
  if (templateName) {
    return opaqueInteractiveFallback({
      title: `Template: ${templateName}`,
      buttons
    });
  }
  if (buttons.length > 0) {
    return opaqueInteractiveFallback({ buttons });
  }
  return fallback;
}

function parseMessageContent(
  msg: Record<string, unknown>,
  payload?: Record<string, unknown>,
  depth = 0
): { text: string; type: string } {
  // Wrappers que aninham a mensagem real — desembrulha antes de tudo.
  if (depth < 5) {
    const wrapped =
      (msg.ephemeralMessage as Record<string, unknown> | undefined)?.message ??
      (msg.viewOnceMessage as Record<string, unknown> | undefined)?.message ??
      (msg.viewOnceMessageV2 as Record<string, unknown> | undefined)?.message ??
      (msg.viewOnceMessageV2Extension as Record<string, unknown> | undefined)?.message ??
      (msg.documentWithCaptionMessage as Record<string, unknown> | undefined)?.message ??
      (msg.editedMessage as Record<string, unknown> | undefined)?.message ??
      (msg.deviceSentMessage as Record<string, unknown> | undefined)?.message ??
      (msg.futureProofMessage as Record<string, unknown> | undefined)?.message ??
      (msg.botInvokeMessage as Record<string, unknown> | undefined)?.message ??
      (msg.associatedChildMessage as Record<string, unknown> | undefined)?.message ??
      (msg.groupStatusMessage as Record<string, unknown> | undefined)?.message;
    if (wrapped) {
      const inner = coerceMessageObject(wrapped);
      if (Object.keys(inner).length > 0) {
        return parseMessageContent(inner, payload, depth + 1);
      }
    }
  }

  if (typeof msg.conversation === "string" && msg.conversation.trim()) {
    return { text: msg.conversation.trim(), type: "chat" };
  }
  if (msg.extendedTextMessage && typeof msg.extendedTextMessage === "object") {
    const ext = msg.extendedTextMessage as Record<string, unknown>;
    return { text: String(ext.text ?? "").trim(), type: "chat" };
  }

  const opaque = opaqueInteractiveFallback();

  // Mensagens com BOTÃO / template / lista / interativas (API oficial / Meta→você).
  // Sem isto, caíam no fallback vazio e eram DESCARTADAS (nunca gravadas).
  if (msg.templateMessage && typeof msg.templateMessage === "object") {
    const tm = msg.templateMessage as Record<string, any>;
    const h =
      tm.hydratedTemplate ??
      tm.hydratedFourRowTemplate ??
      tm.fourRowTemplate ??
      tm.hydratedHsm ??
      tm;
    // Meta Cloud (Evolution Business) manda name/components no próprio templateMessage,
    // às vezes sem hydratedTemplate — mescla os dois níveis.
    const merged = h === tm ? tm : { ...tm, ...h, components: h.components ?? tm.components };
    return {
      text: extractTemplateLikeText(
        merged,
        merged.hydratedButtons ?? tm.hydratedButtons,
        opaqueInteractiveFallback({ kind: "template" })
      ),
      type: "chat"
    };
  }
  // Evolution Business às vezes espelha o template Meta sem embrulhar em templateMessage.
  if (Array.isArray((msg as Record<string, unknown>).components)) {
    const comps = (msg as Record<string, unknown>).components;
    const looksMeta = asObjectList(comps).some((c) =>
      /^(header|body|footer|button|buttons)$/i.test(String(c.type ?? ""))
    );
    if (looksMeta) {
      return {
        text: extractTemplateLikeText(
          msg as Record<string, any>,
          undefined,
          opaqueInteractiveFallback({ kind: "template" })
        ),
        type: "chat"
      };
    }
  }
  if (msg.buttonsMessage && typeof msg.buttonsMessage === "object") {
    const bm = msg.buttonsMessage as Record<string, any>;
    return {
      text: extractTemplateLikeText(
        bm,
        bm.buttons,
        opaqueInteractiveFallback({ kind: "botões" })
      ),
      type: "chat"
    };
  }
  if (msg.interactiveMessage && typeof msg.interactiveMessage === "object") {
    const im = msg.interactiveMessage as Record<string, any>;
    const cards = asObjectList(im.carouselMessage?.cards);
    const cardTexts = cards.flatMap((c) => [
      ...textFieldsFrom(c),
      ...textFieldsFrom(c.body),
      ...textFieldsFrom(c.header),
      ...textsFromParamsJson(c.nativeFlowMessage?.messageParamsJson)
    ]);
    const cardButtons = cards.flatMap((c) =>
      buttonLabels(c.nativeFlowMessage?.buttons ?? c.buttons)
    );
    const buttons = uniqKeepOrder([
      ...buttonLabels(im.nativeFlowMessage?.buttons),
      ...buttonLabels(im.buttonMessage?.buttons),
      ...buttonLabels(im.buttons),
      ...cardButtons
    ]);
    const deep = deepHarvestInteractive(im);
    const text = composeButtonText(
      uniqKeepOrder([
        im.header?.title,
        im.body?.text,
        im.footer?.text,
        ...textFieldsFrom(im),
        ...textsFromParamsJson(im.nativeFlowMessage?.messageParamsJson),
        ...cardTexts,
        ...deep.parts
      ]),
      uniqKeepOrder([...buttons, ...deep.buttons]),
      ""
    );
    return {
      text:
        text && !isButtonPlaceholderBody(text)
          ? text
          : opaqueInteractiveFallback({
              kind: "interativa",
              buttons: uniqKeepOrder([...buttons, ...deep.buttons])
            }),
      type: "chat"
    };
  }
  if (msg.listMessage && typeof msg.listMessage === "object") {
    const lm = msg.listMessage as Record<string, any>;
    const rows: string[] = [];
    for (const sec of asObjectList(lm.sections)) {
      for (const row of asObjectList(sec.rows)) {
        const title = String(row?.title ?? "").trim();
        if (title) rows.push(title);
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
    const h = hs.hydratedHsm ?? hs;
    return {
      text: extractTemplateLikeText(
        h,
        h.hydratedButtons,
        opaqueInteractiveFallback({ kind: "HSM" })
      ),
      type: "chat"
    };
  }
  if (msg.productMessage && typeof msg.productMessage === "object") {
    const pm = msg.productMessage as Record<string, any>;
    const product = (pm.product ?? pm) as Record<string, any>;
    const text = composeButtonText(
      [
        product.title ?? product.name,
        product.description,
        product.currencyCode && product.priceAmount1000 != null
          ? `${product.currencyCode} ${(Number(product.priceAmount1000) / 1000).toFixed(2)}`
          : ""
      ],
      [],
      opaqueInteractiveFallback({ kind: "produto" })
    );
    return { text, type: "chat" };
  }
  if (msg.groupInviteMessage && typeof msg.groupInviteMessage === "object") {
    const gi = msg.groupInviteMessage as Record<string, any>;
    const text = composeButtonText(
      [gi.groupName ? `Convite: ${gi.groupName}` : "Convite de grupo", gi.caption ?? gi.inviteMessage],
      [],
      opaqueInteractiveFallback({ kind: "convite" })
    );
    return { text, type: "chat" };
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

  // Último recurso: anúncio/CTA no contextInfo (às vezes o template vem vazio).
  const ctx =
    (msg.messageContextInfo as Record<string, any> | undefined) ??
    (payload?.contextInfo as Record<string, any> | undefined);
  const ad = ctx?.externalAdReply;
  if (ad && typeof ad === "object") {
    const text = composeButtonText(
      [ad.title, ad.body, ad.mediaUrl ?? ad.sourceUrl],
      [],
      ""
    );
    if (text) return { text, type: "chat" };
  }

  // Varredura profunda no message + payload antes de desistir.
  const harvested = deepHarvestInteractive({ msg, payload });
  const harvestedText = composeButtonText(
    uniqKeepOrder(harvested.parts).slice(0, 6),
    uniqKeepOrder(harvested.buttons).slice(0, 8),
    ""
  );
  if (harvestedText && !isButtonPlaceholderBody(harvestedText)) {
    return { text: harvestedText, type: "chat" };
  }

  const payloadType = String(payload?.messageType ?? "").toLowerCase();
  if (
    payloadType.includes("template") ||
    payloadType.includes("button") ||
    payloadType.includes("interactive") ||
    payloadType.includes("hsm") ||
    payloadType.includes("list")
  ) {
    return {
      text: opaqueInteractiveFallback({
        kind: payloadType.replace(/message$/i, "") || "Meta",
        buttons: uniqKeepOrder(harvested.buttons).slice(0, 8)
      }),
      type: "chat"
    };
  }
  if (payloadType.includes("audio")) return { text: "", type: "audio" };
  if (payloadType.includes("image")) return { text: "", type: "image" };
  if (payloadType.includes("video")) return { text: "", type: "video" };
  if (payloadType.includes("document")) return { text: "📎 Documento", type: "document" };
  if (payloadType.includes("sticker")) return { text: "", type: "sticker" };

  // Se o message tem chaves tipicamente interativas mas vazias:
  if (
    msg.templateMessage ||
    msg.buttonsMessage ||
    msg.interactiveMessage ||
    msg.highlyStructuredMessage
  ) {
    return { text: opaque, type: "chat" };
  }

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

  const msg = coerceMessageObject(payload.message);
  let { text, type } = parseMessageContent(msg, payload);

  // Echo Evolution ao enviar template oficial: conversation = "▶️nome◀️".
  if (typeof text === "string") {
    const echo = textFromEvolutionTemplateEcho(text);
    if (echo) {
      text = echo;
      type = "chat";
    }
  }

  // Se o template veio vazio mas o payload tem texto paralelo (alguns syncs Evolution).
  if (isButtonPlaceholderBody(text) || !text.trim()) {
    const sideCandidates = [payload.text, payload.body, payload.conversation, msg.conversation]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
    for (const sideText of sideCandidates) {
      const echo = textFromEvolutionTemplateEcho(sideText);
      if (echo) {
        text = echo;
        type = "chat";
        break;
      }
      if (!isButtonPlaceholderBody(sideText)) {
        text = sideText;
        type = "chat";
        break;
      }
    }
  }

  // Último recurso: components Meta no payload (fora de message.*).
  if (isButtonPlaceholderBody(text) || !text.trim()) {
    const tpl =
      (payload.template as Record<string, unknown> | undefined) ??
      (msg.template as Record<string, unknown> | undefined);
    if (tpl && typeof tpl === "object") {
      const hydrated = extractTemplateLikeText(tpl as Record<string, any>, undefined, "");
      if (hydrated) {
        text = hydrated;
        type = "chat";
      }
    }
  }

  const mediaTypes = new Set(["image", "video", "audio", "ptt", "sticker", "document"]);
  if (type === "chat" && !text.trim()) return null;
  if (!text.trim() && !mediaTypes.has(type)) return null;

  const waMessageId = String(key.id ?? payload.id ?? "").trim() || null;

  const ts = parseWhatsAppTimestamp(
    payload.messageTimestamp ?? payload.timestamp ?? key.timestamp ?? (payload.message as Record<string, unknown> | undefined)?.messageTimestamp
  );

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
