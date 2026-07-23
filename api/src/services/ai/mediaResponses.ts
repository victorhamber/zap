import { randomUUID } from "node:crypto";
import type { AiMediaResponse, AiMediaResponseKind } from "../../types/ai.js";

const VALID_KINDS: AiMediaResponseKind[] = ["text", "image", "video", "audio", "document"];

/** Sanitiza a lista recebida do painel para gravar (gera id, remove linhas vazias). */
export function normalizeMediaResponsesForSave(raw: unknown): AiMediaResponse[] {
  if (!Array.isArray(raw)) return [];
  const out: AiMediaResponse[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = VALID_KINDS.includes(o.kind as AiMediaResponseKind)
      ? (o.kind as AiMediaResponseKind)
      : "text";
    const triggers = Array.isArray(o.triggers)
      ? [...new Set(o.triggers.map((t) => String(t).trim()).filter(Boolean))]
      : [];
    const text = String(o.text ?? "");
    const mediaUrl = String(o.mediaUrl ?? "").trim();
    // descarta linha completamente vazia (usuário adicionou e não preencheu)
    if (triggers.length === 0 && !text.trim() && !mediaUrl) continue;
    out.push({
      id: String(o.id ?? "").trim() || randomUUID(),
      label: String(o.label ?? "").trim(),
      triggers,
      text,
      kind,
      mediaUrl,
      filename: String(o.filename ?? "").trim(),
      enabled: o.enabled !== false
    });
  }
  return out;
}

/** Lê o JSON do banco em uma lista tipada e saneada. */
export function parseMediaResponses(raw: unknown): AiMediaResponse[] {
  if (!Array.isArray(raw)) return [];
  const out: AiMediaResponse[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    if (!id) continue;
    const kind = VALID_KINDS.includes(o.kind as AiMediaResponseKind)
      ? (o.kind as AiMediaResponseKind)
      : "text";
    const triggers = Array.isArray(o.triggers)
      ? o.triggers.map((t) => String(t).trim()).filter(Boolean)
      : [];
    out.push({
      id,
      label: String(o.label ?? "").trim(),
      triggers,
      text: String(o.text ?? ""),
      kind,
      mediaUrl: String(o.mediaUrl ?? "").trim(),
      filename: String(o.filename ?? "").trim(),
      enabled: o.enabled !== false
    });
  }
  return out;
}

/** Só respostas utilizáveis: ativas, com gatilho, e com texto OU mídia. */
export function usableMediaResponses(list: AiMediaResponse[]): AiMediaResponse[] {
  return list.filter(
    (r) =>
      r.enabled &&
      r.triggers.length > 0 &&
      (r.text.trim().length > 0 || (r.kind !== "text" && r.mediaUrl.length > 0))
  );
}

/**
 * Bloco para o system prompt. Instrui o modelo a devolver SÓ o marcador
 * [[MIDIA:<id>]] quando o cliente perguntar algo equivalente a um gatilho —
 * o envio da mídia é feito pelo código, não pelo texto do modelo.
 */
export function buildMediaResponsesBlock(list: AiMediaResponse[]): string {
  const usable = usableMediaResponses(list);
  if (usable.length === 0) return "";

  const lines = usable.map((r) => {
    const gatilhos = r.triggers.map((t) => `"${t}"`).join(", ");
    const oQue = r.kind === "text" ? "uma resposta pronta" : `um(a) ${r.kind}`;
    return `- id ${r.id} (${oQue}${r.label ? ` — ${r.label}` : ""}): quando o cliente perguntar algo equivalente a ${gatilhos}`;
  });

  return [
    "## RESPOSTAS PRONTAS COM MÍDIA",
    "Se — e SOMENTE se — a mensagem do cliente for equivalente (mesmo com outras palavras, gírias ou por áudio) a um dos gatilhos abaixo, responda com APENAS o marcador correspondente, exatamente neste formato e nada mais: [[MIDIA:<id>]]",
    "Não escreva mais nada junto do marcador. Se a pergunta não corresponder claramente a nenhum gatilho, ignore esta seção e responda normalmente.",
    ...lines
  ].join("\n");
}

const MARKER_RE = /\[\[\s*MIDIA\s*:\s*([a-zA-Z0-9_-]+)\s*\]\]/i;

/** Extrai o id do marcador [[MIDIA:id]] da resposta do modelo, se houver. */
export function extractMediaResponseMarker(reply: string): string | null {
  const m = reply.match(MARKER_RE);
  return m ? m[1] : null;
}

export function stripMediaResponseMarker(reply: string): string {
  return reply.replace(MARKER_RE, "").trim();
}

export function findMediaResponse(
  list: AiMediaResponse[],
  id: string
): AiMediaResponse | null {
  return usableMediaResponses(list).find((r) => r.id === id) ?? null;
}
