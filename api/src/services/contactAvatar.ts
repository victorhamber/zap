import * as wpp from "./whatsapp/index.js";
import { buildWppSendTarget } from "./wppSend.js";

const cache = new Map<string, { url: string; expiresAt: number }>();
const TTL_MS = 6 * 60 * 60 * 1000;

export async function getContactAvatarUrl(
  chatId: string,
  isGroup?: boolean
): Promise<string | null> {
  const target = buildWppSendTarget(chatId, isGroup);
  const key = target.jid;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.url;

  try {
    const url = await wpp.getChatPictureDataUrl(target.jid);
    if (url) {
      cache.set(key, { url, expiresAt: Date.now() + TTL_MS });
      return url;
    }
  } catch {
    /* sem foto */
  }
  return null;
}
