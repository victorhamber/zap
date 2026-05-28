import * as wpp from "./wppconnect.js";

export type ChatKind = "direct" | "group" | "community";

export type NormalizedChat = {
  id: string;
  phone: string;
  name: string;
  lastMessage: string;
  timestamp: number;
  isGroup: boolean;
  kind: ChatKind;
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
  return digitsOnly(base) || base;
}

function resolveChatId(chatId: string, isGroup?: boolean): string {
  if (chatId.includes("@")) return chatId;
  const clean = digitsOnly(chatId);
  if (!clean) return chatId;
  if (isGroup) return `${clean}@g.us`;
  return `${clean}@c.us`;
}

function detectKind(id: string, o?: Record<string, unknown>): ChatKind {
  if (id.includes("@newsletter") || o?.isCommunity === true) return "community";
  if (id.includes("@g.us") || o?.isGroup === true) return "group";
  return "direct";
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

  const id = String(o.id ?? o.chatId ?? o._id ?? o.phone ?? "");
  if (!id || id === "undefined") return null;

  const phone = chatIdToPhone(id);
  const contactObj =
    o.contact && typeof o.contact === "object"
      ? (o.contact as Record<string, unknown>)
      : null;
  const kind = detectKind(id, o);
  const name = String(
    o.name ??
      o.formattedTitle ??
      contactObj?.name ??
      o.pushname ??
      o.shortName ??
      (kind === "direct" ? phone : id.split("@")[0])
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

  const isGroup = kind === "group" || kind === "community";

  return {
    id: id.includes("@") ? id : resolveChatId(id, isGroup),
    phone,
    name: name || phone || "Contato",
    lastMessage: lastBody.slice(0, 120),
    timestamp: ts || Date.now(),
    isGroup,
    kind,
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
    else if (o.response && typeof o.response === "object") {
      list = Object.values(o.response as Record<string, unknown>);
    }
  }

  return list.map(parseChatItem).filter((c): c is NormalizedChat => Boolean(c));
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

async function mergeChatSource(
  map: Map<string, NormalizedChat>,
  fetcher: () => Promise<unknown>
): Promise<void> {
  try {
    const raw = await fetcher();
    for (const c of normalizeChats(raw)) {
      const key = c.id;
      const prev = map.get(key);
      if (!prev || c.timestamp >= prev.timestamp) map.set(key, c);
    }
  } catch {
    /* fonte opcional */
  }
}

export async function fetchChats(): Promise<NormalizedChat[]> {
  const map = new Map<string, NormalizedChat>();

  await mergeChatSource(map, () => wpp.callSessionApi("/all-chats", "GET"));
  await mergeChatSource(map, () => wpp.callSessionApi("/list-chats", "GET"));
  await mergeChatSource(map, () => wpp.callSessionApi("/all-chats-with-messages", "GET"));

  return [...map.values()].sort((a, b) => b.timestamp - a.timestamp);
}

function pathPhone(chatId: string): string {
  return encodeURIComponent(chatId);
}

export async function fetchMessages(
  _phone: string,
  options: FetchMessagesOptions
): Promise<{ messages: NormalizedMessage[]; hint?: string }> {
  const count = options.count ?? 30;
  const chatId = resolveChatId(options.chatId, options.isGroup);
  const isGroup = chatId.includes("@g.us") || options.isGroup === true;
  const pathId = pathPhone(chatId);
  const digits = digitsOnly(chatId);

  const attempts: Array<{ label: string; run: () => Promise<unknown> }> = [
    {
      label: "all-messages-in-chat",
      run: () => wpp.callSessionApi(`/all-messages-in-chat/${pathId}`, "GET")
    },
    {
      label: "get-messages",
      run: () => wpp.callSessionApi(`/get-messages/${pathId}`, "GET")
    },
    {
      label: "get-messages-digits",
      run: () => wpp.callSessionApi(`/get-messages/${digits}`, "GET")
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

  return {
    messages: [],
    hint:
      errors[0]?.slice(0, 220) ??
      "Histórico indisponível neste chat. Novas mensagens aparecem ao enviar/receber."
  };
}

export async function sendChatMessage(
  chatId: string,
  message: string,
  isGroup = false
): Promise<void> {
  const chatPhone = resolveChatId(chatId, isGroup);
  await wpp.callSessionApi("/send-message", "POST", {
    phone: chatPhone,
    message,
    isGroup: isGroup || chatPhone.includes("@g.us")
  });
}

export async function sendChatMedia(
  chatId: string,
  type: "image" | "video" | "audio" | "document",
  url: string,
  options?: { caption?: string; isGroup?: boolean; filename?: string }
): Promise<void> {
  const phone = resolveChatId(chatId, options?.isGroup);
  const isGroup = options?.isGroup || phone.includes("@g.us");
  const base = { phone, isGroup };

  if (type === "image") {
    await wpp.callSessionApi("/send-image", "POST", {
      ...base,
      path: url,
      caption: options?.caption ?? ""
    });
    return;
  }
  if (type === "video") {
    await wpp.callSessionApi("/send-file", "POST", {
      ...base,
      path: url,
      caption: options?.caption ?? ""
    });
    return;
  }
  if (type === "audio") {
    await wpp.callSessionApi("/send-voice", "POST", {
      ...base,
      path: url
    });
    return;
  }

  await wpp.callSessionApi("/send-file", "POST", {
    ...base,
    path: url,
    filename: options?.filename ?? "documento",
    caption: options?.caption ?? ""
  });
}
