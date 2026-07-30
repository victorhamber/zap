import { env } from "../env.js";
import * as wpp from "./whatsapp/index.js";
import { extractWaId } from "./inbox.js";
import {
  getInboxSessionName,
  messageSyncJidCandidates,
  parseWppWebhookMessage,
  saveInboxMessage
} from "./inboxStore.js";
import { buildWppSendTarget } from "./wppSend.js";
import { parseEvolutionMessagePayload } from "./whatsapp/evolutionWebhook.js";

const lastSyncByChat = new Map<string, number>();
const SYNC_COOLDOWN_MS = 45_000;
const SYNC_COOLDOWN_OPEN_MS = 12_000;

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

function extractEvolutionMessageRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  }
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.records)) {
    return o.records.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  }
  if (o.messages && typeof o.messages === "object") {
    const m = o.messages as Record<string, unknown>;
    if (Array.isArray(m.records)) {
      return m.records.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
    }
    if (Array.isArray(m)) {
      return m.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
    }
  }
  for (const key of ["response", "data"] as const) {
    const val = o[key];
    if (Array.isArray(val)) {
      return val.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
    }
  }
  return [];
}

async function syncEvolutionMessagesForJid(
  jid: string,
  isGroup: boolean | undefined,
  count: number,
  session: string
): Promise<number> {
  let raw: unknown;
  try {
    raw = await wpp.callSessionApi(
      `/get-messages/${encodeURIComponent(jid)}?count=${Math.min(count, 50)}`,
      "GET"
    );
  } catch {
    return 0;
  }

  const list = extractEvolutionMessageRecords(raw);
  let saved = 0;

  for (const payload of list) {
    const parsed = parseEvolutionMessagePayload(
      { event: "messages.upsert", instance: session },
      payload
    );
    if (!parsed) continue;

    const msgKey = (payload.key ?? {}) as Record<string, unknown>;
    const { hydrateTemplatePlaceholder } = await import("./whatsapp/metaTemplates.js");
    const messageBody = await hydrateTemplatePlaceholder({
      session,
      text: parsed.text,
      raw: payload
    });
    await saveInboxMessage({
      chatId: parsed.chatId,
      body: messageBody,
      fromMe: parsed.fromMe,
      type: parsed.type === "ptt" ? "audio" : parsed.type,
      mediaUrl: parsed.mediaUrl,
      waMessageId: parsed.waMessageId,
      timestamp: parsed.timestamp,
      sessionName: session,
      peerJids: [
        String(msgKey.remoteJid ?? ""),
        String(msgKey.remoteJidAlt ?? ""),
        String(msgKey.participant ?? ""),
        String(msgKey.participantAlt ?? ""),
        jid
      ].filter(Boolean)
    });
    saved++;
  }

  return saved;
}

async function syncRecentMessagesFromEvolution(
  chatId: string,
  isGroup?: boolean,
  count = 40,
  sessionName?: string
): Promise<number> {
  const session = (sessionName ?? (await getInboxSessionName())).trim().toLowerCase();
  const target = buildWppSendTarget(chatId, isGroup);
  const key = target.jid;
  const now = Date.now();
  const last = lastSyncByChat.get(key) ?? 0;
  if (now - last < SYNC_COOLDOWN_OPEN_MS) return 0;
  lastSyncByChat.set(key, now);

  const jids = [...new Set(messageSyncJidCandidates(chatId, isGroup))];
  let saved = 0;
  for (const jid of jids) {
    saved += await syncEvolutionMessagesForJid(jid, isGroup, count, session);
  }
  return saved;
}

/** Fallback quando o webhook não grava: puxa mensagens recentes do WPP para o Postgres. */
export async function syncRecentMessagesFromWpp(
  chatId: string,
  isGroup?: boolean,
  count = 35,
  sessionName?: string
): Promise<number> {
  if (env.WHATSAPP_PROVIDER === "evolution") {
    return syncRecentMessagesFromEvolution(chatId, isGroup, count, sessionName);
  }

  const session = (sessionName ?? (await getInboxSessionName())).trim().toLowerCase();
  const target = buildWppSendTarget(chatId, isGroup);
  const key = target.jid;
  const now = Date.now();
  const last = lastSyncByChat.get(key) ?? 0;
  if (now - last < SYNC_COOLDOWN_MS) return 0;
  lastSyncByChat.set(key, now);

  const remoteJid = encodeURIComponent(target.jid);
  let raw: unknown;
  try {
    raw = await wpp.callSessionApi(
      `/get-messages/${remoteJid}?count=${Math.min(count, 50)}`,
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
      timestamp: parsed.timestamp,
      sessionName: session
    });
    saved++;
  }
  return saved;
}
