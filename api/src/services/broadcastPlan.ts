import { humanGapMs } from "./flowStagger.js";

/** Pausa entre grupos. Cada chamada sorteia um valor diferente. */
export const GROUP_GAP_MIN_SEC = 25;
export const GROUP_GAP_MAX_SEC = 70;

export function groupGapMs(): number {
  return humanGapMs(GROUP_GAP_MIN_SEC, GROUP_GAP_MAX_SEC);
}

export function emailGapMs(minSec: number, maxSec: number): number {
  return humanGapMs(minSec, maxSec);
}

export function filterGroupIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id.endsWith("@g.us") || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export const BROADCAST_MEDIA_KINDS = ["image", "video", "audio", "document"] as const;
export type BroadcastMediaKind = (typeof BROADCAST_MEDIA_KINDS)[number];

export type BroadcastMedia = {
  kind: BroadcastMediaKind;
  url: string;
  filename: string;
};

export function parseBroadcastMedia(raw: unknown): BroadcastMedia | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = String(o.kind ?? "");
  const url = String(o.url ?? "").trim();
  const filename = String(o.filename ?? "").trim().slice(0, 180);
  if (!BROADCAST_MEDIA_KINDS.includes(kind as BroadcastMediaKind)) return null;
  if (!/^https?:\/\//i.test(url) || url.length > 2000) return null;
  return { kind: kind as BroadcastMediaKind, url, filename };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function textToEmailHtml(text: string, media?: BroadcastMedia | null): string {
  const body = text.trim()
    ? escapeHtml(text)
        .split(/\n{2,}/)
        .map((part) => `<p>${part.replace(/\n/g, "<br>")}</p>`)
        .join("")
    : "";
  if (!media) return body;
  if (media.kind === "image") {
    return `${body}<p><img src="${escapeHtml(media.url)}" alt="" style="max-width:100%"></p>`;
  }
  const label = escapeHtml(media.filename || "Arquivo");
  return `${body}<p><a href="${escapeHtml(media.url)}">${label}</a></p>`;
}
