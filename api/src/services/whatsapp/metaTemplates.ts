/**
 * Hidratação de templates oficiais Meta (Cloud API).
 *
 * O webhook de template (envio/echo) só carrega `{ name, language, components }`
 * com os PARÂMETROS — o texto do corpo mora no cadastro do template lá na Meta.
 * Sem buscar a definição, o inbox só conseguia mostrar "📄 Template: nome".
 * Aqui a definição é baixada do Graph API, cacheada e mesclada com os parâmetros
 * recebidos para reconstruir a mensagem como o cliente viu.
 */
import { asObjectList } from "./templateText.js";
import { getWppInstanceConfig } from "./wppInstanceConfig.js";

const GRAPH_VERSION = "v21.0";
const CACHE_TTL_MS = 60 * 60_000;
const NEGATIVE_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;

export type MetaTemplateButton = { label: string; url?: string };

export type MetaTemplateDefinition = {
  name: string;
  language: string;
  /** Componentes do cadastro: HEADER / BODY / FOOTER / BUTTONS. */
  components: Record<string, unknown>[];
};

type CacheEntry = { definition: MetaTemplateDefinition | null; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<MetaTemplateDefinition | null>>();

function cacheKey(session: string, name: string, language: string): string {
  return `${session.trim().toLowerCase()}|${name.trim().toLowerCase()}|${language.trim().toLowerCase()}`;
}

/** Só o idioma base importa para casar pt_BR com pt-BR / pt. */
function languageRoot(language: string): string {
  return language.trim().toLowerCase().replace(/-/g, "_").split("_")[0];
}

export function clearMetaTemplateCache(): void {
  cache.clear();
  inflight.clear();
}

async function fetchTemplateDefinition(
  session: string,
  name: string,
  language: string
): Promise<MetaTemplateDefinition | null> {
  const cfg = await getWppInstanceConfig(session);
  if (!cfg || cfg.integration !== "business") return null;
  if (!cfg.metaBusinessId || !cfg.metaAccessToken) return null;

  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(cfg.metaBusinessId)}` +
    `/message_templates?limit=50&name=${encodeURIComponent(name)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.metaAccessToken}` },
      signal: controller.signal
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: unknown };
    const list = asObjectList(json.data);

    const exact = list.filter((t) => String(t.name ?? "").trim() === name.trim());
    const pool = exact.length > 0 ? exact : list;
    if (pool.length === 0) return null;

    const wantedRoot = languageRoot(language);
    const matched =
      pool.find((t) => String(t.language ?? "").toLowerCase() === language.trim().toLowerCase()) ??
      pool.find((t) => languageRoot(String(t.language ?? "")) === wantedRoot) ??
      pool[0];

    return {
      name: String(matched.name ?? name),
      language: String(matched.language ?? language),
      components: asObjectList(matched.components)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getMetaTemplateDefinition(
  session: string,
  name: string,
  language = ""
): Promise<MetaTemplateDefinition | null> {
  const cleanName = name.trim();
  if (!session.trim() || !cleanName) return null;

  const key = cacheKey(session, cleanName, language);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.definition;

  const running = inflight.get(key);
  if (running) return running;

  const task = fetchTemplateDefinition(session, cleanName, language)
    .then((definition) => {
      cache.set(key, {
        definition,
        expiresAt: Date.now() + (definition ? CACHE_TTL_MS : NEGATIVE_TTL_MS)
      });
      return definition;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, task);
  return task;
}

/** Valores enviados em um componente do webhook (`parameters`), em ordem. */
function parameterValues(component: Record<string, unknown> | undefined): {
  positional: string[];
  named: Map<string, string>;
} {
  const positional: string[] = [];
  const named = new Map<string, string>();
  for (const p of asObjectList(component?.parameters)) {
    const value =
      (typeof p.text === "string" && p.text.trim()) ||
      (typeof p.payload === "string" && p.payload.trim()) ||
      String(
        (p.image as Record<string, unknown> | undefined)?.link ??
          (p.video as Record<string, unknown> | undefined)?.link ??
          (p.document as Record<string, unknown> | undefined)?.filename ??
          (p.document as Record<string, unknown> | undefined)?.link ??
          (p.currency as Record<string, unknown> | undefined)?.fallback_value ??
          (p.date_time as Record<string, unknown> | undefined)?.fallback_value ??
          ""
      ).trim();
    positional.push(value);
    const key = String(p.parameter_name ?? p.parameterName ?? "").trim().toLowerCase();
    if (key) named.set(key, value);
  }
  return { positional, named };
}

/** Troca {{1}}, {{2}} e {{nome_var}} pelos valores enviados. */
function applyParameters(
  text: string,
  values: { positional: string[]; named: Map<string, string> }
): string {
  return text.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (whole, token: string) => {
    if (/^\d+$/.test(token)) {
      const v = values.positional[Number(token) - 1];
      return v === undefined ? whole : v;
    }
    const v = values.named.get(token.toLowerCase());
    return v === undefined ? whole : v;
  });
}

function componentByType(
  components: Record<string, unknown>[],
  type: string
): Record<string, unknown> | undefined {
  return components.find((c) => String(c.type ?? "").toLowerCase() === type);
}

/** Junta a definição (texto do cadastro) com os parâmetros vindos do webhook. */
export function renderMetaTemplate(
  definition: MetaTemplateDefinition,
  sentComponents: unknown
): { parts: string[]; buttons: MetaTemplateButton[] } {
  const sent = asObjectList(sentComponents);
  const parts: string[] = [];
  const buttons: MetaTemplateButton[] = [];

  const sentButtons = sent.filter((c) => String(c.type ?? "").toLowerCase() === "button");

  for (const comp of definition.components) {
    const type = String(comp.type ?? "").toLowerCase();

    if (type === "header") {
      const format = String(comp.format ?? "TEXT").toUpperCase();
      if (format !== "TEXT") continue;
      const raw = String(comp.text ?? "").trim();
      if (!raw) continue;
      parts.push(applyParameters(raw, parameterValues(componentByType(sent, "header"))));
      continue;
    }

    if (type === "body" || type === "footer") {
      const raw = String(comp.text ?? "").trim();
      if (!raw) continue;
      parts.push(applyParameters(raw, parameterValues(componentByType(sent, type))));
      continue;
    }

    if (type === "buttons") {
      const defined = asObjectList(comp.buttons);
      defined.forEach((b, index) => {
        const label = String(b.text ?? b.title ?? "").trim();
        const rawUrl = String(b.url ?? "").trim();
        if (!label && !rawUrl) return;
        // Botão URL dinâmico: o sufixo {{1}} vem no componente "button" do envio.
        const sentForIndex = sentButtons.find(
          (c) => String(c.index ?? "") === String(index) || Number(c.index) === index
        );
        const url = rawUrl
          ? applyParameters(rawUrl, parameterValues(sentForIndex))
          : undefined;
        buttons.push({ label: label || url || "Botão", url });
      });
    }
  }

  return { parts: parts.filter(Boolean), buttons };
}

/** Localiza `{ name, language, components }` em qualquer nível do payload. */
function findTemplateNode(
  value: unknown,
  depth = 0
): { name: string; language: string; components: unknown } | null {
  if (!value || typeof value !== "object" || depth > 6) return null;
  const o = value as Record<string, unknown>;

  const name = String(o.name ?? "").trim();
  if (name && ("components" in o || "language" in o)) {
    return {
      name,
      language: String(
        (o.language as Record<string, unknown> | undefined)?.code ?? o.language ?? ""
      ),
      components: o.components
    };
  }

  for (const key of [
    "templateMessage",
    "template",
    "hydratedTemplate",
    "hydratedFourRowTemplate",
    "hydratedHsm",
    "message",
    "data"
  ]) {
    const found = findTemplateNode(o[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Reaproveita a hidratação para mensagens que chegaram pela Evolution Business
 * (API oficial encapsulada), onde o texto gravado vira "📄 Template: nome".
 * Devolve o texto original quando não há como reconstruir.
 */
export async function hydrateTemplatePlaceholder(params: {
  session: string;
  text: string;
  raw?: unknown;
}): Promise<string> {
  const text = params.text ?? "";
  const namedPlaceholder = text.trim().match(/^📄\s*Template:\s*(.+)$/i);
  const isGeneric = /^(📄\s*)?(Mensagem com botões|Mensagem interativa)$/i.test(text.trim());
  if (!namedPlaceholder && !isGeneric) return text;

  const node = findTemplateNode(params.raw);
  const name = (namedPlaceholder?.[1] ?? node?.name ?? "").trim();
  if (!name) return text;

  try {
    const hydrated = await hydrateMetaTemplateText({
      session: params.session,
      name,
      language: node?.language ?? "",
      components: node?.components
    });
    return hydrated ?? text;
  } catch {
    return text;
  }
}

/** Texto pronto para o inbox, ou null quando a definição não pôde ser obtida. */
export async function hydrateMetaTemplateText(params: {
  session: string;
  name: string;
  language?: string;
  components?: unknown;
}): Promise<string | null> {
  const definition = await getMetaTemplateDefinition(
    params.session,
    params.name,
    params.language ?? ""
  );
  if (!definition) return null;

  const { parts, buttons } = renderMetaTemplate(definition, params.components);
  const lines = [...parts];
  for (const b of buttons) {
    lines.push(b.url ? `▸ ${b.label} → ${b.url}` : `▸ ${b.label}`);
  }
  const text = lines.join("\n").trim();
  return text || null;
}
