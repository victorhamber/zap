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

export type FetchMessagesOptions = {
  chatId: string;
  isGroup?: boolean;
  count?: number;
};

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

function chatIdToPhone(id: string): string {
  const base = id.replace(/@.*/, "");
  return digitsOnly(base);
}

function resolveChatId(chatId: string, isGroup?: boolean): string {
  if (chatId.includes("@")) return chatId;
  const clean = digitsOnly(chatId);
  if (isGroup) return `${clean}@g.us`;
  return `${clean}@c.us`;
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

function messageBody(o: Record<string, unknown>): string {
  const type = String(o.type ?? "chat");
  const text = String(o.body ?? o.content ?? o.caption ?? o.text ?? "");
  if (text.trim()) return text;
  if (type === "image" || type === "sticker") return "📷 Imagem";
  if (type === "video") return "🎬 Vídeo";
  if (type === "audio" || type === "ptt") return "🎤 Áudio";
  if (type === "document") return "📎 Documento";
  if (type === "location") return "📍 Localização";
  return "";
}

function parseMessageItem(item: unknown): NormalizedMessage | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const body = messageBody(o);
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

function extractMessageList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];

  const o = raw as Record<string, unknown>;
  const keys = ["response", "messages", "data", "items", "msgs"] as const;

  for (const key of keys) {
    const val = o[key];
    if (Array.isArray(val)) return val;
    if (val && typeof val === "object") {
      const nested = extractMessageList(val);
      if (nested.length > 0) return nested;
    }
  }

  if (o.response && typeof o.response === "object" && !Array.isArray(o.response)) {
    const resp = o.response as Record<string, unknown>;
    for (const v of Object.values(resp)) {
      if (Array.isArray(v)) return v;
    }
  }

  return [];
}

export function normalizeMessages(raw: unknown): NormalizedMessage[] {
  const list = extractMessageList(raw);
  return list
    .map(parseMessageItem)
    .filter((m): m is NormalizedMessage => Boolean(m))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function fetchChats(): Promise<NormalizedChat[]> {
  const raw = await wpp.callSessionApi("/all-chats", "GET");
  return normalizeChats(raw);
}

function phoneForPath(chatId: string): string {
  return encodeURIComponent(chatId);
}

export async function fetchMessages(
  _phone: string,
  options: FetchMessagesOptions
): Promise<{ messages: NormalizedMessage[]; hint?: string }> {
  const count = options.count ?? 50;
  const chatId = resolveChatId(options.chatId, options.isGroup);
  const pathPhone = phoneForPath(chatId);
  const isGroup = chatId.includes("@g.us");

  const attempts: Array<{ label: string; run: () => Promise<unknown> }> = [
    {
      label: "load-messages-in-chat",
      run: () => wpp.callSessionApi(`/load-messages-in-chat/${pathPhone}`, "GET")
    },
    {
      label: "all-messages-in-chat",
      run: () => wpp.callSessionApi(`/all-messages-in-chat/${pathPhone}`, "GET")
    },
    {
      label: "get-messages",
      run: () => wpp.callSessionApi(`/get-messages/${pathPhone}`, "GET")
    },
    {
      label: "get-messages-post",
      run: () =>
        wpp.callSessionApi("/get-messages", "POST", {
          phone: chatId,
          count,
          isGroup
        })
    }
  ];

  const errors: string[] = [];

  for (const { label, run } of attempts) {
    try {
      const raw = await run();
      const msgs = normalizeMessages(raw);
      if (msgs.length > 0) return { messages: msgs };
    } catch (e: any) {
      errors.push(`${label}: ${e?.message ?? e}`);
    }
  }

  try {
    const raw = await wpp.callSessionApi("/all-chats-with-messages", "GET");
    const chats = normalizeChats(raw);
    const match = chats.find((c) => c.id === chatId || c.phone === chatIdToPhone(chatId));
    if (match?.lastMessage) {
      return {
        messages: [
          {
            id: "preview",
            body: match.lastMessage,
            fromMe: false,
            timestamp: match.timestamp,
            type: "chat"
          }
        ],
        hint: "Histórico completo indisponível; exibindo última mensagem do chat."
      };
    }
  } catch {
    /* ignora */
  }

  return {
    messages: [],
    hint:
      errors[0]?.slice(0, 200) ??
      "Não foi possível carregar mensagens. Confira se o WhatsApp está conectado."
  };
}

export async function sendChatMessage(
  phone: string,
  message: string,
  isGroup = false
): Promise<void> {
  const chatPhone = resolveChatId(phone.includes("@") ? phone : phone, isGroup);

  await wpp.callSessionApi("/send-message", "POST", {
    phone: chatPhone,
    message,
    isGroup: isGroup || chatPhone.includes("@g.us")
  });
}
