/** Extração de texto legível de templates oficiais Meta / botões. */

/** Array ou mapa numérico (protobuf JSON às vezes serializa assim). */
export function asObjectList(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is Record<string, any> => Boolean(x) && typeof x === "object");
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).filter(
      (x): x is Record<string, any> => Boolean(x) && typeof x === "object"
    );
  }
  return [];
}

/**
 * API oficial Meta / Evolution Business: template vem como
 * `{ name, language, components: [{ type: BODY|HEADER|FOOTER|BUTTONS, text?, parameters?, buttons? }] }`
 * — sem hydratedContentText do Baileys.
 */
export function extractMetaTemplateComponents(components: unknown): {
  parts: string[];
  buttons: string[];
} {
  const parts: string[] = [];
  const buttons: string[] = [];

  for (const c of asObjectList(components)) {
    const ctype = String(c.type ?? "").toLowerCase();

    if (ctype === "header" || ctype === "body" || ctype === "footer") {
      const direct = String(c.text ?? "").trim();
      if (direct) {
        parts.push(direct);
        continue;
      }
      const paramTexts = asObjectList(c.parameters)
        .map((p) => {
          if (typeof p.text === "string" && p.text.trim()) return p.text.trim();
          if (typeof p.payload === "string" && p.payload.trim()) return p.payload.trim();
          const img = p.image as Record<string, unknown> | undefined;
          if (img && typeof img.link === "string" && img.link.trim()) return String(img.link).trim();
          const doc = p.document as Record<string, unknown> | undefined;
          if (doc) {
            const fn = String(doc.filename ?? doc.file_name ?? "").trim();
            if (fn) return fn;
          }
          const vid = p.video as Record<string, unknown> | undefined;
          if (vid && typeof vid.link === "string" && vid.link.trim()) return String(vid.link).trim();
          return "";
        })
        .filter(Boolean);
      if (paramTexts.length) parts.push(paramTexts.join(" · "));
      continue;
    }

    if (ctype === "buttons") {
      for (const b of asObjectList(c.buttons)) {
        const label = String(b.text ?? b.title ?? "").trim();
        const url = String(b.url ?? "").trim();
        if (label) buttons.push(url ? `${label} → ${url}` : label);
        else if (url) buttons.push(url);
      }
      continue;
    }

    if (ctype === "button") {
      const label = String(c.text ?? "").trim();
      const paramTexts = asObjectList(c.parameters)
        .map((p) => String(p.text ?? p.payload ?? "").trim())
        .filter(Boolean);
      const joined = [label, ...paramTexts].filter(Boolean).join(" ");
      if (joined) buttons.push(joined);
    }
  }

  return { parts, buttons };
}
