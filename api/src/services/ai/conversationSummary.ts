import { prisma } from "../../prisma.js";
import { labelForMediaType } from "../mediaText.js";
import { expandChatIdVariants } from "../waLidMap.js";
import { env } from "../../env.js";

const MAX_HISTORY_CHARS = 22_000;

type HistoryRow = {
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
  if (source === "manual") return "Atendente (humano)";
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

function formatHistoryLine(row: HistoryRow): string {
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

/** Mantém as mensagens mais recentes se o histórico exceder o limite de caracteres. */
function trimHistoryToCharBudget(lines: string[], maxChars: number): string {
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const add = line.length + 1;
    if (size + add > maxChars && kept.length > 0) break;
    kept.unshift(line);
    size += add;
  }
  if (kept.length < lines.length && kept.length > 0) {
    return `(… ${lines.length - kept.length} mensagens mais antigas omitidas por limite técnico)\n${kept.join("\n")}`;
  }
  return kept.join("\n");
}

/**
 * Histórico completo da conversa (cronológico), com origem de cada mensagem.
 * Usado na resposta da IA para manter continuidade real do diálogo.
 */
export async function buildFullChatHistoryForAi(
  session: string,
  chatId: string,
  messageLimit = env.AI_HISTORY_MESSAGE_LIMIT
): Promise<string> {
  if (!prisma) return "(sem histórico nesta conversa)";

  const variants = await expandChatIdVariants(session, chatId);
  const rows = await prisma.inboxMessage.findMany({
    where: { session, chatId: { in: variants } },
    orderBy: { timestamp: "desc" },
    take: messageLimit,
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

  if (rows.length === 0) return "(sem histórico nesta conversa)";

  rows.reverse();
  const deduped = dedupeHistoryRows(rows);
  const lines = deduped.map(formatHistoryLine);
  const joined = trimHistoryToCharBudget(lines, MAX_HISTORY_CHARS);

  return joined || "(sem histórico nesta conversa)";
}
