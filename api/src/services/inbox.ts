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

/** Extrai ID serializado do WhatsApp (ex.: 120363…@g.us) quando o WPP devolve objeto Wid. */
export function extractWaId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (!s || s === "undefined" || s === "[object Object]") return "";
    return s;
  }
  if (typeof value !== "object") return "";

  const o = value as Record<string, unknown>;
  if (typeof o._serialized === "string") return extractWaId(o._serialized);
  if (typeof o.id === "string" || (o.id && typeof o.id === "object")) {
    const nested = extractWaId(o.id);
    if (nested) return nested;
  }
  const user = o.user ?? o.userid;
  const server = o.server;
  if (user != null && server != null) {
    return `${String(user).replace(/\D/g, "") || String(user)}@${String(server)}`;
  }
  return "";
}

function isValidWaId(id: string): boolean {
  return (
    Boolean(id) &&
    !id.includes("[object Object]") &&
    /^[a-zA-Z0-9._+-]+@[a-z0-9.]+$/i.test(id)
  );
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

  const rawId =
    extractWaId(o.id) ||
    extractWaId(o.chatId) ||
    extractWaId(o._id) ||
    extractWaId(o.phone) ||
    String(o.phone ?? "").trim();
  if (!rawId || rawId === "undefined") return null;

  const kindHint = detectKind(rawId.includes("@") ? rawId : `${rawId}@c.us`, o);
  const resolvedId = rawId.includes("@")
    ? rawId
    : resolveChatId(rawId, kindHint === "group" || kindHint === "community" || o.isGroup === true);
  if (!isValidWaId(resolvedId)) return null;

  const phone = chatIdToPhone(resolvedId);
  const contactObj =
    o.contact && typeof o.contact === "object"
      ? (o.contact as Record<string, unknown>)
      : null;
  const kind = detectKind(resolvedId, o);
  const name = String(
    o.name ??
      o.formattedTitle ??
      contactObj?.name ??
      o.pushname ??
      o.shortName ??
      (kind === "direct" ? phone : resolvedId.split("@")[0])
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
    id: resolvedId,
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

function extractArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  for (const key of ["response", "chats", "data", "contacts", "groups", "records"]) {
    const val = o[key];
    if (Array.isArray(val)) return val;
  }
  if (o.response && typeof o.response === "object" && !Array.isArray(o.response)) {
    return Object.values(o.response as Record<string, unknown>);
  }
  return [];
}

function mergeChats(map: Map<string, NormalizedChat>, list: NormalizedChat[]) {
  for (const c of list) {
    const prev = map.get(c.id);
    if (!prev || c.timestamp >= prev.timestamp) map.set(c.id, c);
  }
}

export function normalizeGroups(raw: unknown): NormalizedChat[] {
  const list = extractArray(raw);
  const out: NormalizedChat[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      const raw = item.trim();
      const id = raw.includes("@") ? raw : `${raw.replace(/\D/g, "")}@g.us`;
      if (!isValidWaId(id)) continue;
      out.push({
        id,
        phone: chatIdToPhone(id),
        name: item,
        lastMessage: "",
        timestamp: Date.now(),
        isGroup: true,
        kind: "group",
        unreadCount: 0
      });
      continue;
    }
    const c = parseChatItem(item);
    if (!c) continue;
    c.kind = idIncludesCommunity(c.id) ? "community" : "group";
    c.isGroup = true;
    if (!c.id.includes("@")) c.id = `${c.phone}@g.us`;
    out.push(c);
  }
  return out;
}

function idIncludesCommunity(id: string): boolean {
  return id.includes("@newsletter");
}

export type FetchChatsResult = {
  chats: NormalizedChat[];
  sourcesOk: string[];
  errors: string[];
};

export async function fetchChats(): Promise<FetchChatsResult> {
  const map = new Map<string, NormalizedChat>();
  const sourcesOk: string[] = [];
  const errors: string[] = [];

  const tasks: Array<{
    name: string;
    run: () => Promise<unknown>;
    parse: (raw: unknown) => NormalizedChat[];
  }> = [
    {
      name: "all-chats",
      run: () => wpp.callSessionApi("/all-chats", "GET"),
      parse: normalizeChats
    },
    {
      name: "list-chats",
      run: () => wpp.callSessionApi("/list-chats", "POST", {}),
      parse: normalizeChats
    },
    {
      name: "all-contacts",
      run: () => wpp.callSessionApi("/all-contacts", "GET"),
      parse: normalizeChats
    },
    {
      name: "all-groups",
      run: () => wpp.callSessionApi("/all-groups", "GET"),
      parse: normalizeGroups
    }
  ];

  const results = await Promise.allSettled(tasks.map((t) => t.run()));

  results.forEach((result, i) => {
    const task = tasks[i];
    if (result.status === "fulfilled") {
      const parsed = task.parse(result.value);
      if (parsed.length > 0) {
        sourcesOk.push(`${task.name} (${parsed.length})`);
        mergeChats(map, parsed);
      } else {
        errors.push(`${task.name}: resposta vazia`);
      }
    } else {
      const msg =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${task.name}: ${msg}`);
    }
  });

  const chats = [...map.values()].sort((a, b) => b.timestamp - a.timestamp);
  return { chats, sourcesOk, errors };
}

function pathPhone(chatId: string): string {
  const safe = chatId.trim();
  if (!isValidWaId(safe)) {
    throw new Error("ID do chat inválido");
  }
  return safe;
}

export async function fetchMessages(
  _phone: string,
  options: FetchMessagesOptions
): Promise<{ messages: NormalizedMessage[]; hint?: string }> {
  const count = options.count ?? 30;
  const chatId = resolveChatId(options.chatId, options.isGroup);
  const isGroup = chatId.includes("@g.us") || options.isGroup === true;
  let pathId: string;
  try {
    pathId = pathPhone(chatId);
  } catch {
    return {
      messages: [],
      hint: "ID do chat inválido. Clique em ↻ na lista de conversas e abra o chat de novo."
    };
  }

  const msgQuery = `count=${count}`;
  const allInChatQuery = `isGroup=${isGroup ? "true" : "false"}&includeMe=true&includeNotifications=true`;

  const attempts: Array<{ label: string; run: () => Promise<unknown> }> = [
    {
      label: "get-messages",
      run: () => wpp.callSessionApi(`/get-messages/${pathId}?${msgQuery}`, "GET")
    },
    {
      label: "all-messages-in-chat",
      run: () =>
        wpp.callSessionApi(`/all-messages-in-chat/${pathId}?${allInChatQuery}`, "GET")
    },
    {
      label: "load-messages-in-chat",
      run: () =>
        wpp.callSessionApi(`/load-messages-in-chat/${pathId}?${allInChatQuery}`, "GET")
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
