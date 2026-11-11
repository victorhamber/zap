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

export function textToEmailHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((part) => `<p>${part.replace(/\n/g, "<br>")}</p>`)
    .join("");
}
