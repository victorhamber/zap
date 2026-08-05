export type FlatJsonPath = {
  path: string;
  value: string;
  type: "string" | "number" | "boolean";
};

/**
 * Achata um JSON em caminhos legíveis ($.a.b[0].c) para o mapeamento
 * do webhook personalizado na UI.
 */
export function flattenJsonPaths(
  input: unknown,
  opts?: { maxDepth?: number; maxLeaves?: number }
): FlatJsonPath[] {
  const maxDepth = opts?.maxDepth ?? 8;
  const maxLeaves = opts?.maxLeaves ?? 250;
  const out: FlatJsonPath[] = [];

  function walk(node: unknown, path: string, depth: number) {
    if (out.length >= maxLeaves || depth > maxDepth) return;
    if (node == null) return;

    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      if (!path) return;
      out.push({
        path,
        value: String(node).slice(0, 200),
        type: typeof node as "string" | "number" | "boolean"
      });
      return;
    }

    if (Array.isArray(node)) {
      node.slice(0, 30).forEach((item, i) => {
        const next = path ? `${path}[${i}]` : `$[${i}]`;
        walk(item, next, depth + 1);
      });
      return;
    }

    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
        const next = path ? `${path}.${k}` : `$.${k}`;
        walk(v, next, depth + 1);
      }
    }
  }

  walk(input, "", 0);
  return out;
}

/** Sugere path para phone/name/email a partir do sample. */
export function suggestWebhookFieldPath(
  paths: FlatJsonPath[],
  kind: "phone" | "name" | "email" | "externalId"
): string {
  const scored = paths.map((p) => {
    const key = p.path.toLowerCase();
    const val = p.value.trim();
    let score = 0;
    if (kind === "email") {
      if (/email|e[_-]?mail|mail/.test(key)) score += 5;
      if (/@/.test(val)) score += 3;
    } else if (kind === "phone") {
      if (/phone|tel|whatsapp|celular|mobile|telefone|checkout_phone/.test(key)) score += 5;
      const digits = val.replace(/\D/g, "");
      if (digits.length >= 10 && digits.length <= 15) score += 3;
    } else if (kind === "name") {
      if (/(^|\.)(name|nome|full_?name|buyer\.name|customer\.name)(\.|$)/.test(key)) score += 5;
      if (/first_?name|nome/.test(key)) score += 3;
      if (/@/.test(val) || /^\d+$/.test(val)) score -= 4;
    } else if (kind === "externalId") {
      if (/(^|\.)(id|transaction|order_?id|purchase_?id|event_?id)(\.|$)/.test(key)) score += 4;
      if (/uuid|external/.test(key)) score += 2;
    }
    return { path: p.path, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].path : "";
}
