import { prisma } from "../../prisma.js";
import { resolveAllChatIdsForContact } from "../inboxStore.js";

export type KnowledgeRow = {
  id: string;
  kind: string;
  topic: string | null;
  content: string;
  chatId: string;
  createdAt: Date;
};

const SESSION_KNOWLEDGE_POOL = 2500;
export const DEFAULT_KNOWLEDGE_REPLY_LIMIT = 20;

const KIND_WEIGHT: Record<string, number> = {
  qa_pair: 120,
  answer: 70,
  question: 25
};

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inboundTokens(inboundText: string): string[] {
  const stop = new Set([
    "que",
    "qual",
    "como",
    "para",
    "por",
    "com",
    "uma",
    "uns",
    "the",
    "você",
    "voce",
    "isso",
    "essa",
    "esse",
    "aqui",
    "ola",
    "oi"
  ]);
  return [
    ...new Set(
      normalizeText(inboundText)
        .split(/\W+/)
        .filter((w) => w.length >= 3 && !stop.has(w))
    )
  ];
}

function parseQaPair(content: string): { question: string; answerBase: string } | null {
  try {
    const o = JSON.parse(content) as { question?: string; answerBase?: string };
    const question = String(o.question ?? "").trim();
    const answerBase = String(o.answerBase ?? "").trim();
    if (!question && !answerBase) return null;
    return { question, answerBase };
  } catch {
    return null;
  }
}

export function extractKnowledgeSearchText(row: KnowledgeRow): string {
  if (row.kind === "qa_pair") {
    const qa = parseQaPair(row.content);
    if (qa) return `${qa.question} ${qa.answerBase} ${row.topic ?? ""}`;
  }
  return `${row.content} ${row.topic ?? ""}`;
}

/** Remove aprendizado obsoleto (ex.: capital mínimo de R$ 1.000). */
export function isKnownWrongCapitalMinimum(text: string): boolean {
  const n = normalizeText(text);
  const hasCapitalContext =
    /capital|deposito|minimo|minima|conta|investir|comecar|cent|standard|usd|dolar|reais/.test(n);
  const wrongReais =
    /r\$\s*1[\s.,]*0{3}|1[\s.,]*0{3}\s*reais|mil\s*reais|pelo\s*menos\s*r\$/.test(n);

  if (/capital\s+minim/.test(n) && /1[\s.,]*0{3}|mil\s*reais|r\$/.test(n)) return true;
  if (wrongReais && hasCapitalContext) return true;
  return false;
}

export function buildOfficialFactsBlock(officialFacts: string): string {
  const lines = officialFacts
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  return lines.join("\n");
}

function scoreKnowledgeRow(
  row: KnowledgeRow,
  tokens: string[],
  sameChat: boolean
): number {
  let score = KIND_WEIGHT[row.kind] ?? 15;
  if (sameChat) score += 35;

  const topic = normalizeText(row.topic ?? "");
  const content = normalizeText(row.content);

  if (row.kind === "qa_pair") {
    const qa = parseQaPair(row.content);
    if (qa) {
      const q = normalizeText(qa.question);
      const a = normalizeText(qa.answerBase);
      for (const t of tokens) {
        if (q.includes(t)) score += 14;
        if (a.includes(t)) score += 5;
        if (topic.includes(t)) score += 8;
      }
      if (tokens.length === 0) score += 5;
      return score;
    }
  }

  for (const t of tokens) {
    if (content.includes(t)) score += 6;
    if (topic.includes(t)) score += 10;
  }

  const ageDays = (Date.now() - row.createdAt.getTime()) / 86_400_000;
  score += Math.max(0, 8 - ageDays * 0.05);

  return score;
}

export function formatKnowledgeSnippet(row: KnowledgeRow): string {
  if (row.kind === "qa_pair") {
    const qa = parseQaPair(row.content);
    if (qa) {
      const topic = row.topic?.trim();
      return [
        `[qa_pair${topic ? ` — ${topic}` : ""}]`,
        `Pergunta: ${qa.question}`,
        `Resposta base (como o atendente respondeu): ${qa.answerBase}`
      ].join("\n");
    }
  }
  const topic = row.topic?.trim();
  return `[${row.kind}${topic ? ` — ${topic}` : ""}] ${row.content}`;
}

function dedupeSnippets(rows: KnowledgeRow[]): KnowledgeRow[] {
  const seen = new Set<string>();
  const out: KnowledgeRow[] = [];
  for (const row of rows) {
    const key = `${row.kind}|${normalizeText(row.content).slice(0, 200)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** Aprendizado de toda a instância, ranqueado pela mensagem do cliente. */
export async function fetchSessionKnowledgeForReply(params: {
  session: string;
  chatId: string;
  inboundText?: string;
  limit?: number;
}): Promise<string[]> {
  if (!prisma) return [];

  const limit = params.limit ?? DEFAULT_KNOWLEDGE_REPLY_LIMIT;
  const session = params.session.trim().toLowerCase();
  const tokens = inboundTokens(params.inboundText ?? "");

  let sameChatIds = new Set<string>();
  try {
    sameChatIds = new Set(await resolveAllChatIdsForContact(session, params.chatId));
  } catch {
    sameChatIds = new Set([params.chatId]);
  }

  const rows = await prisma.instanceAiKnowledge.findMany({
    where: { session },
    orderBy: { createdAt: "desc" },
    take: SESSION_KNOWLEDGE_POOL,
    select: {
      id: true,
      kind: true,
      topic: true,
      content: true,
      chatId: true,
      createdAt: true
    }
  });

  if (rows.length === 0) return [];

  const ranked = rows
    .map((row) => ({
      row,
      score: scoreKnowledgeRow(row, tokens, sameChatIds.has(row.chatId))
    }))
    .filter(({ row }) => !isKnownWrongCapitalMinimum(extractKnowledgeSearchText(row)))
    .sort((a, b) => b.score - a.score || b.row.createdAt.getTime() - a.row.createdAt.getTime());

  const picked = dedupeSnippets(ranked.map((r) => r.row)).slice(0, limit);
  return picked.map(formatKnowledgeSnippet);
}
