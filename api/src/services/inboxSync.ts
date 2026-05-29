import * as wpp from "./wppconnect.js";
import { extractWaId } from "./inbox.js";
import { parseWppWebhookMessage, saveInboxMessage } from "./inboxStore.js";
import { buildWppSendTarget } from "./wppSend.js";

const lastSyncByChat = new Map<string, number>();
const SYNC_COOLDOWN_MS = 25_000;

function messageToWebhookShape(item: Record<string, unknown>): Record<string, unknown> {
  return {
    event: "onmessage",
    from: item.from ?? item.author,
    to: item.to,
    chatId: item.chatId ?? item.from,
    body: item.body ?? item.content ?? item.caption,
    type: item.type,
    fromMe: item.fromMe,
    id: item.id,
    timestamp: item.timestamp ?? item.t,
    mimetype: item.mimetype,
    isMedia: item.isMedia
  };
}

/** Fallback quando o webhook não grava: puxa mensagens recentes do WPP para o Postgres. */
export async function syncRecentMessagesFromWpp(
  chatId: string,
  isGroup?: boolean,
  count = 35
): Promise<number> {
  const target = buildWppSendTarget(chatId, isGroup);
  const key = target.jid;
  const now = Date.now();
  const last = lastSyncByChat.get(key) ?? 0;
  if (now - last < SYNC_COOLDOWN_MS) return 0;
  lastSyncByChat.set(key, now);

  const phone = encodeURIComponent(target.phone);
  let raw: unknown;
  try {
    raw = await wpp.callSessionApi(
      `/get-messages/${phone}?count=${Math.min(count, 50)}`,
      "GET"
    );
  } catch {
    return 0;
  }

  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.response)) list = o.response;
    else if (Array.isArray(o.messages)) list = o.messages;
    else if (o.response && typeof o.response === "object") {
      const r = o.response as Record<string, unknown>;
      if (Array.isArray(r.messages)) list = r.messages;
      else list = Object.values(r);
    }
  }

  let saved = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const shaped = messageToWebhookShape(item as Record<string, unknown>);
    const parsed = parseWppWebhookMessage(shaped);
    if (!parsed) continue;
    const peer = extractWaId(shaped.chatId) || extractWaId(shaped.from) || parsed.chatId;
    if (peer && peer !== parsed.chatId) {
      parsed.chatId = peer;
    }
    await saveInboxMessage({
      chatId: parsed.chatId,
      body: parsed.text,
      fromMe: parsed.fromMe,
      type: parsed.type === "ptt" ? "audio" : parsed.type,
      mediaUrl: parsed.mediaUrl,
      waMessageId: parsed.waMessageId,
      timestamp: parsed.timestamp
    });
    saved++;
  }
  return saved;
}
