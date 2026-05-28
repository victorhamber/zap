export function getByPath(input: unknown, path: string): unknown {
  if (!path) return undefined;

  const normalized = path
    .trim()
    .replace(/^\$\.?/, "")
    .replace(/^\./, "");

  if (!normalized) return input;

  const tokens: (string | number)[] = [];

  for (const raw of normalized.split(".")) {
    if (!raw) continue;
    const re = /^([^\[]+)(?:\[(\d+)\])?$/;
    const m = raw.match(re);
    if (!m) {
      tokens.push(raw);
      continue;
    }
    tokens.push(m[1]!);
    if (m[2] != null) tokens.push(Number(m[2]));
  }

  let cur: any = input;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = cur[t as any];
  }
  return cur;
}

export function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}
