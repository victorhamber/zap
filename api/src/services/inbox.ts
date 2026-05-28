import * as wpp from "./wppconnect.js";

export type NormalizedChat = {
  id: string;
  phone: string;
  name: string;
  lastMessage: string;
  timestamp: number;
  isGroup: boolean;
  unreadCount: number;
};

export type NormalizedMessage = {
  id: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  type: string;
};

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

function chatIdToPhone(id: string): string {
  const base = id.replace(/@.*/, "");
  return digitsOnly(base);
}

function parseTimestamp(v: unknown): number {
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    const n = Date.parse(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function parseChatItem(item: unknown): NormalizedChat | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;

  const id = String(o.id ?? o.chatId ?? o._id ?? "");
  if (!id) return null;

  const phone = chatIdToPhone(id);
  const contactObj =
    o.contact && typeof o.contact === "object"
      ? (o.contact as Record<string, unknown>)
      : null;
  const name = String(
    o.name ?? o.formattedTitle ?? contactObj?.name ?? o.pushname ?? phone
  );
  const lastMsg =
    o.lastMessage && typeof o.lastMessage === "object"
      ? (o.lastMessage as Record<string, unknown>)
      : o;

  const lastBody = String(
    lastMsg?.body ??
      lastMsg?.content ??
      lastMsg?.caption ??
      o.msg ??
      o.preview ??
      ""
  );

  const ts = parseTimestamp(
    lastMsg?.timestamp ?? lastMsg?.t ?? o.t ?? o.timestamp ?? o.time
  );

  const isGroup = id.includes("@g.us") || o.isGroup === true;

  return {
    id,
    phone,
    name: name || phone,
    lastMessage: lastBody.slice(0, 120),
    timestamp: ts || Date.now(),
    isGroup,
    unreadCount: Number(o.unreadCount ?? o.unread ?? 0) || 0
  };
}

export function normalizeChats(raw: unknown): NormalizedChat[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.response)) list = o.response;
    else if (Array.isArray(o.chats)) list = o.chats;
    else if (Array.isArray(o.data)) list = o.data;
  }

  const map = new Map<string, NormalizedChat>();
  for (const item of list) {
    const chat = parseChatItem(item);
    if (!chat) continue;
    const key = chat.isGroup ? chat.id : chat.phone;
    const prev = map.get(key);
    if (!prev || chat.timestamp >= prev.timestamp) map.set(key, chat);
  }

  return [...map.values()].sort((a, b) => b.timestamp - a.timestamp);
}

function parseMessageItem(item: unknown): NormalizedMessage | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const body = String(o.body ?? o.content ?? o.caption ?? o.text ?? "");
  const id = String(o.id ?? o._id ?? `${o.timestamp ?? o.t ?? Date.now()}_${body.slice(0, 8)}`);
  const fromMe =
    o.fromMe === true ||
    o.fromMe === "true" ||
    (typeof o.ack === "string" && /fromme|sender/i.test(o.ack));
  return {
    id,
    body,
    fromMe,
    timestamp: parseTimestamp(o.timestamp ?? o.t ?? o.messageTimestamp),
    type: String(o.type ?? "chat")
  };
}

export function normalizeMessages(raw: unknown): NormalizedMessage[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.response)) list = o.response;
    else if (Array.isArray(o.messages)) list = o.messages;
    else if (Array.isArray(o.data)) list = o.data;
  }

  return list
    .map(parseMessageItem)
    .filter((m): m is NormalizedMessage => Boolean(m))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function fetchChats(): Promise<NormalizedChat[]> {
  const raw = await wpp.callSessionApi("/all-chats", "GET");
  return normalizeChats(raw);
}

export async function fetchMessages(phone: string, count = 40): Promise<NormalizedMessage[]> {
  const clean = digitsOnly(phone);
  const chatId = phone.includes("@") ? phone : `${clean}@c.us`;

  const attempts: Array<() => Promise<unknown>> = [
    () =>
      wpp.callSessionApi("/get-messages", "POST", {
        phone: chatId,
        count,
        isGroup: chatId.includes("@g.us")
      }),
    () => wpp.callSessionApi(`/get-messages/${encodeURIComponent(clean)}`, "GET"),
    () =>
      wpp.callSessionApi("/get-all-messages-in-chat", "POST", {
        phone: chatId,
        count,
        isGroup: chatId.includes("@g.us")
      })
  ];

  for (const fn of attempts) {
    try {
      const raw = await fn();
      const msgs = normalizeMessages(raw);
      if (msgs.length > 0) return msgs;
    } catch {
      /* próxima rota */
    }
  }

  return [];
}

export async function sendChatMessage(
  phone: string,
  message: string,
  isGroup = false
): Promise<void> {
  const clean = digitsOnly(phone);
  const chatPhone =
    phone.includes("@") ? phone : isGroup ? `${clean}@g.us` : `${clean}@c.us`;

  await wpp.callSessionApi("/send-message", "POST", {
    phone: chatPhone,
    message,
    isGroup: isGroup || chatPhone.includes("@g.us")
  });
}
