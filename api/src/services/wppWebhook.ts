/** Detecção de payload de mensagem no webhook WPPConnect (não confundir `event` com `type`). */

let lastWppWebhookAt: string | null = null;
let lastWppWebhookEvent: string | null = null;

export function touchWppWebhookReceived(event?: string): void {
  lastWppWebhookAt = new Date().toISOString();
  if (event) lastWppWebhookEvent = event;
}

export function getLastWppWebhookAt(): string | null {
  return lastWppWebhookAt;
}

export function getLastWppWebhookEvent(): string | null {
  return lastWppWebhookEvent;
}

const SKIP_EVENTS = new Set([
  "ack",
  "onack",
  "presence",
  "onpresencechanged",
  "battery",
  "statechange",
  "revoked",
  "onrevokedmessage",
  "reaction",
  "onreactionmessage",
  "poll",
  "onpollresponse",
  "status",
  "status-find",
  "labels",
  "onupdatelabel",
  "group_update",
  "onparticipantschanged",
  "call",
  "incomingcall",
  "disconnected",
  "connected",
  "qr",
  "qrcode",
  "loading",
  "authenticated",
  "closesession",
  "logoutsession",
  "phonecode",
  "session-logged"
]);

const MESSAGE_EVENTS = new Set([
  "onmessage",
  "message",
  "onanymessage",
  "anymessage",
  "onselfmessage",
  "selfmessage",
  "unreadmessages"
]);

const CONTENT_TYPES = new Set([
  "chat",
  "image",
  "video",
  "audio",
  "ptt",
  "document",
  "sticker",
  "vcard",
  "location",
  "gp2",
  "list",
  "buttons_response",
  "template_button_reply"
]);

/** WPP envia `{ event, session, ...camposDaMensagem }`; alguns proxies aninham em `data`. */
export function normalizeWppWebhookBody(
  body: Record<string, unknown>
): Record<string, unknown> {
  const data = body.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const nested = data as Record<string, unknown>;
    const hasMsgFields =
      nested.from !== undefined ||
      nested.chatId !== undefined ||
      nested.body !== undefined ||
      nested.type !== undefined;
    if (hasMsgFields) {
      return {
        ...nested,
        event: body.event ?? nested.event,
        session: body.session ?? nested.session
      };
    }
  }

  const msg = body.message;
  if (msg && typeof msg === "object" && !Array.isArray(msg)) {
    const nested = msg as Record<string, unknown>;
    return {
      ...nested,
      event: body.event ?? nested.event,
      session: body.session ?? nested.session
    };
  }

  return body;
}

export function getWppWebhookEvent(body: Record<string, unknown>): string {
  return String(body.event ?? "").toLowerCase();
}

export function getWppMessageContentType(body: Record<string, unknown>): string {
  return String(body.type ?? "chat").toLowerCase();
}

export function isWppMessageWebhook(body: Record<string, unknown>): boolean {
  const normalized = normalizeWppWebhookBody(body);
  const ev = getWppWebhookEvent(normalized);
  if (ev) {
    if (SKIP_EVENTS.has(ev)) return false;
    if (MESSAGE_EVENTS.has(ev)) return true;
  }

  if (normalized.message && typeof normalized.message === "object") return true;

  const from = normalized.from ?? normalized.chatId;
  if (!from) return false;

  if (
    normalized.ack !== undefined &&
    normalized.body === undefined &&
    !normalized.isMedia &&
    !normalized.mimetype
  ) {
    return false;
  }

  const ct = getWppMessageContentType(normalized);
  if (CONTENT_TYPES.has(ct)) return true;
  if (normalized.isMedia === true || normalized.isMMS === true) return true;
  if (
    normalized.body !== undefined ||
    normalized.content !== undefined ||
    normalized.caption !== undefined
  ) {
    return true;
  }

  return false;
}
