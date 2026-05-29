import * as wpp from "./wppconnect.js";
import { buildWppSendTarget } from "./wppSend.js";

const cache = new Map<string, { url: string; expiresAt: number }>();
const TTL_MS = 6 * 60 * 60 * 1000;

function extractProfilePicUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const resp = o.response ?? o.profilePicUrl ?? o.img ?? o.url;
  if (typeof resp === "string" && resp.trim()) {
    const s = resp.trim();
    if (s.startsWith("http") || s.startsWith("data:")) return s;
  }
  if (resp && typeof resp === "object") {
    const r = resp as Record<string, unknown>;
    for (const key of ["eurl", "imgFull", "img", "profilePicThumb", "url"] as const) {
      const v = r[key];
      if (typeof v === "string" && (v.startsWith("http") || v.startsWith("data:"))) return v;
    }
  }
  return null;
}

export async function getContactAvatarUrl(
  chatId: string,
  isGroup?: boolean
): Promise<string | null> {
  const target = buildWppSendTarget(chatId, isGroup);
  const key = target.jid;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.url;

  try {
    const phone = encodeURIComponent(target.phone);
    const raw = await wpp.callSessionApi(`/profile-pic/${phone}`, "GET");
    const url = extractProfilePicUrl(raw);
    if (url) {
      cache.set(key, { url, expiresAt: Date.now() + TTL_MS });
      return url;
    }
  } catch {
    /* sem foto */
  }
  return null;
}
