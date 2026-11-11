import * as wpp from "./whatsapp/index.js";
import { buildWppSendTarget } from "./wppSend.js";

const cache = new Map<string, { url: string; expiresAt: number }>();
const missUntil = new Map<string, number>();
const TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 30 * 60 * 1000;

export async function getContactAvatarUrl(
  chatId: string,
  isGroup?: boolean
): Promise<string | null> {
  const target = buildWppSendTarget(chatId, isGroup);
  const key = target.jid;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.url;
  if ((missUntil.get(key) ?? 0) > Date.now()) return null;

  try {
    let url = await wpp.getChatPictureDataUrl(target.jid);
    if (!url && (target.isGroup || target.isNewsletter)) {
      url = await wpp.getChatPictureDataUrl(target.jid, true);
    }
    if (url) {
      missUntil.delete(key);
      cache.set(key, { url, expiresAt: Date.now() + TTL_MS });
      return url;
    }
  } catch {
    /* sem foto */
  }
  missUntil.set(key, Date.now() + MISS_TTL_MS);
  return null;
}
