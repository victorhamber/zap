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

// Peso do TIPO é só um desempate entre linhas que já casaram a pergunta —
// não o termo dominante. Antes valia 120 (qa_pair), 8x mais que o melhor
// sinal de relevância (+14 por palavra), então um qa_pair sem NENHUMA palavra
// em comum vencia uma resposta perfeitamente relevante.
const KIND_WEIGHT: Record<string, number> = {
  qa_pair: 30,
  answer: 15,
  question: 6
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

/** Retorna o score e QUANTAS palavras da pergunta a linha casou (para o piso). */
function scoreKnowledgeRow(
  row: KnowledgeRow,
  tokens: string[],
  sameChat: boolean
): { score: number; matched: number } {
  let score = KIND_WEIGHT[row.kind] ?? 15;
  if (sameChat) score += 35;

  // Recência aplicada uniformemente. Antes ficava DEPOIS do return do qa_pair,
  // ou seja, era código morto justamente para o tipo que domina o ranking.
  const ageDays = (Date.now() - row.createdAt.getTime()) / 86_400_000;
  score += Math.max(0, 8 - ageDays * 0.05);

  const topic = normalizeText(row.topic ?? "");
  const content = normalizeText(row.content);
  let matched = 0;

  if (row.kind === "qa_pair") {
    const qa = parseQaPair(row.content);
    if (qa) {
      const q = normalizeText(qa.question);
      const a = normalizeText(qa.answerBase);
      for (const t of tokens) {
        let hit = false;
        if (q.includes(t)) { score += 14; hit = true; }
        if (a.includes(t)) { score += 5; hit = true; }
        if (topic.includes(t)) { score += 8; hit = true; }
        if (hit) matched++;
      }
      return { score, matched };
    }
  }

  for (const t of tokens) {
    let hit = false;
    if (content.includes(t)) { score += 6; hit = true; }
    if (topic.includes(t)) { score += 10; hit = true; }
    if (hit) matched++;
  }

  return { score, matched };
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

  const hasTokens = tokens.length > 0;

  const ranked = rows
    .map((row) => {
      const sameChat = sameChatIds.has(row.chatId);
      const { score, matched } = scoreKnowledgeRow(row, tokens, sameChat);
      return { row, score, matched, sameChat };
    })
    .filter(({ row }) => !isKnownWrongCapitalMinimum(extractKnowledgeSearchText(row)))
    .filter(({ matched, sameChat }) => {
      // Piso de relevância: quando a pergunta tem palavras úteis, só entra o que
      // casou alguma OU é da conversa deste mesmo contato. Sem isso, quando nada
      // casava o sistema despejava os 20 qa_pairs mais recentes da instância
      // inteira — conhecimento de outros clientes sobre outros assuntos — e ainda
      // instruía o modelo a se basear neles. Sem tokens úteis (ex.: "bom dia"),
      // cai na recência como antes.
      if (!hasTokens) return true;
      return matched > 0 || sameChat;
    })
    .sort((a, b) => b.score - a.score || b.row.createdAt.getTime() - a.row.createdAt.getTime());

  const picked = dedupeSnippets(ranked.map((r) => r.row)).slice(0, limit);
  return picked.map(formatKnowledgeSnippet);
}
