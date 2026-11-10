import * as wpp from "./whatsapp/index.js";
import { buildWppSendTarget } from "./wppSend.js";
import { getInboxSessionName, saveInboxMessage } from "./inboxStore.js";
import { parseWahaMessage } from "./wahaWebhook.js";

const lastSyncByChat = new Map<string, number>();
const SYNC_COOLDOWN_MS = 45_000;

export async function syncRecentMessagesFromWpp(
  chatId: string,
  isGroup?: boolean,
  count = 35,
  sessionName?: string
): Promise<number> {
  const session = (sessionName ?? (await getInboxSessionName())).trim().toLowerCase();
  const target = buildWppSendTarget(chatId, isGroup);
  const key = target.jid;
  const now = Date.now();
  const last = lastSyncByChat.get(key) ?? 0;
  if (now - last < SYNC_COOLDOWN_MS) return 0;
  lastSyncByChat.set(key, now);

  let list: unknown[];
  try {
    list = await wpp.listChatMessages(target.jid, count);
  } catch {
    return 0;
  }

  let saved = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const parsed = parseWahaMessage({ event: "message", session }, item as Record<string, unknown>);
    if (!parsed) continue;
    const { hydrateTemplatePlaceholder } = await import("./whatsapp/metaTemplates.js");
    const messageBody = await hydrateTemplatePlaceholder({
      session,
      text: parsed.text,
      raw: parsed.raw
    });
    await saveInboxMessage({
      chatId: parsed.chatId || target.jid,
      body: messageBody,
      fromMe: parsed.fromMe,
      type: parsed.type === "ptt" ? "audio" : parsed.type,
      mediaUrl: parsed.mediaUrl,
      waMessageId: parsed.waMessageId,
      timestamp: new Date(parsed.timestamp),
      sessionName: session,
      peerJids: [target.jid, parsed.chatId].filter(Boolean)
    });
    saved++;
  }
  return saved;
}
