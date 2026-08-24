import { prisma } from "../../prisma.js";
import { labelForMediaType } from "../mediaText.js";
import { resolveAllChatIdsForContact } from "../inboxStore.js";
import { env } from "../../env.js";
import { openaiChat } from "./openaiClient.js";
import { findChatState, saveConversationMemory } from "./chatState.js";
import { isHumanAnswerSource } from "./learnGate.js";

const MAX_MEMORY_CHARS = 2800;

export type HistoryRow = {
  id: string;
  body: string;
  fromMe: boolean;
  type: string;
  source: string;
  timestamp: Date;
  waMessageId: string | null;
};

function speakerLabel(fromMe: boolean, source: string): string {
  if (!fromMe) return "Cliente";
  if (source === "ai") return "Atendente (IA)";
  if (source === "flow") return "Automação";
  // "manual" (painel) e "webhook" (celular) são o atendente humano — rotular
  // ambos deixa claro para a IA onde um humano assumiu a conversa.
  if (isHumanAnswerSource(source)) return "Atendente (humano)";
  return "Atendente";
}

function formatTs(d: Date): string {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatHistoryLine(row: HistoryRow): string {
  const body = row.body.trim() || labelForMediaType(row.type) || "(mensagem)";
  const who = speakerLabel(row.fromMe, row.source);
  return `[${formatTs(row.timestamp)}] ${who}: ${body}`;
}

function dedupeHistoryRows(rows: HistoryRow[]): HistoryRow[] {
  const seen = new Set<string>();
  const out: HistoryRow[] = [];

  for (const r of rows) {
    const key = r.waMessageId
      ? `wa:${r.waMessageId}`
      : `${r.fromMe ? 1 : 0}|${r.type}|${r.body}|${Math.floor(r.timestamp.getTime() / 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }

  return out;
}

export async function fetchChatHistoryRows(
  session: string,
  chatId: string,
  limit = env.AI_HISTORY_MESSAGE_LIMIT
): Promise<HistoryRow[]> {
  if (!prisma) return [];

  const variants = await resolveAllChatIdsForContact(session, chatId);
  const rows = await prisma.inboxMessage.findMany({
    where: { session, chatId: { in: variants } },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: {
      id: true,
      body: true,
      fromMe: true,
      type: true,
      source: true,
      timestamp: true,
      waMessageId: true
    }
  });

  rows.reverse();
  return dedupeHistoryRows(rows);
}

/**
 * Incorpora mensagens antigas na memória persistente (incremental).
 * Só chama OpenAI quando há mensagens novas suficientes fora da janela recente.
 */
export async function refreshConversationMemory(params: {
  session: string;
  chatId: string;
  apiKey: string;
  model: string;
}): Promise<void> {
  const recentN = env.AI_MEMORY_RECENT_MESSAGES;
  const rows = await fetchChatHistoryRows(params.session, params.chatId);
  if (rows.length <= recentN) return;

  const state = await findChatState(params.session, params.chatId);
  const existingMemory = state?.conversationSummary?.trim() ?? "";
  const lastMemoryId = state?.memoryLastMessageId ?? null;

  const archiveEnd = rows.length - recentN;
  const archiveRows = rows.slice(0, archiveEnd);
  if (archiveRows.length === 0) return;

  let startIdx = 0;
  if (lastMemoryId) {
    const found = archiveRows.findIndex((r) => r.id === lastMemoryId);
    startIdx = found >= 0 ? found + 1 : 0;
  }

  const newRows = archiveRows.slice(startIdx);
  if (newRows.length === 0) return;
  if (newRows.length < env.AI_MEMORY_MIN_NEW_MSGS && existingMemory) return;

  const newLines = newRows.map(formatHistoryLine).join("\n").slice(0, 6000);

  const { text } = await openaiChat({
    apiKey: params.apiKey,
    model: params.model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: [
          "Você mantém a memória persistente de um atendimento WhatsApp.",
          "Atualize a memória com fatos novos sem apagar os importantes.",
          "Inclua: nome do cliente SOMENTE se o próprio cliente disse o nome ou se já estava na memória (nunca copie nomes das falas do atendente — podem ser de outro lead),",
          "tags/status, o que já comprou, o que já foi oferecido ou explicado,",
          "preços já informados, dúvidas em aberto e próximo passo lógico.",
          "Não invente. Máximo 350 palavras. Português do Brasil."
        ].join(" ")
      },
      {
        role: "user",
        content: `MEMÓRIA ATUAL:\n${existingMemory || "(vazia)"}\n\nNOVAS MENSAGENS PARA INCORPORAR:\n${newLines}\n\nMEMÓRIA ATUALIZADA:`
      }
    ]
  });

  const memory = text.trim().slice(0, MAX_MEMORY_CHARS);
  const checkpoint = archiveRows[archiveRows.length - 1]?.id ?? null;
  await saveConversationMemory(params.session, params.chatId, memory, checkpoint, archiveRows.length);
}

/** Memória gravada + janela recente literal — enviado à IA na resposta. */
export async function buildChatContextForReply(params: {
  session: string;
  chatId: string;
  apiKey?: string;
  model?: string;
}): Promise<string> {
  if (params.apiKey && params.model) {
    try {
      await refreshConversationMemory({
        session: params.session,
        chatId: params.chatId,
        apiKey: params.apiKey,
        model: params.model
      });
    } catch (err) {
      console.warn("[ai] refreshConversationMemory failed", err);
    }
  }

  const recentN = env.AI_MEMORY_RECENT_MESSAGES;
  const rows = await fetchChatHistoryRows(params.session, params.chatId);
  if (rows.length === 0) return "(sem histórico nesta conversa)";

  const state = await findChatState(params.session, params.chatId);
  const memory = state?.conversationSummary?.trim();
  const recent = rows.slice(-recentN).map(formatHistoryLine).join("\n");

  if (memory) {
    return [
      "MEMÓRIA DESTA CONVERSA (contexto gravado — continue a partir daqui):",
      memory,
      "",
      "MENSAGENS RECENTES (texto literal):",
      recent
    ].join("\n");
  }

  if (rows.length <= recentN) {
    return ["HISTÓRICO DA CONVERSA:", recent].join("\n");
  }

  return ["MENSAGENS RECENTES:", recent].join("\n");
}
