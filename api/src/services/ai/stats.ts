import { prisma } from "../../prisma.js";
import { getAiQueueCounts } from "../../queue.js";

export type AiStatsDto = {
  session: string;
  knowledgeItems: number;
  messagesLearned: number;
  byKind: { question: number; answer: number; qa_pair: number; other: number };
  learnedEvents: number;
  repliesToday: number;
  errorsRecent: number;
  queuePending: number;
  queueActive: number;
  lastBackfill: { at: string; detail: string } | null;
};

export async function getAiStats(session: string): Promise<AiStatsDto> {
  const s = session.trim().toLowerCase();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  if (!prisma) {
    return {
      session: s,
      knowledgeItems: 0,
      messagesLearned: 0,
      byKind: { question: 0, answer: 0, qa_pair: 0, other: 0 },
      learnedEvents: 0,
      repliesToday: 0,
      errorsRecent: 0,
      queuePending: 0,
      queueActive: 0,
      lastBackfill: null
    };
  }

  const [
    knowledgeItems,
    distinctSources,
    kindGroups,
    learnedEvents,
    repliesToday,
    errorsRecent,
    lastBackfillRow
  ] = await Promise.all([
    prisma.instanceAiKnowledge.count({ where: { session: s } }),
    prisma.instanceAiKnowledge.findMany({
      where: { session: s, sourceMsgId: { not: null } },
      distinct: ["sourceMsgId"],
      select: { sourceMsgId: true }
    }),
    prisma.instanceAiKnowledge.groupBy({
      by: ["kind"],
      where: { session: s },
      _count: { kind: true }
    }),
    prisma.instanceAiEvent.count({
      where: { session: s, event: "learned", createdAt: { gte: since24h } }
    }),
    prisma.instanceAiEvent.count({
      where: { session: s, event: "replied", createdAt: { gte: startOfDay } }
    }),
    prisma.instanceAiEvent.count({
      where: { session: s, event: "error", createdAt: { gte: since24h } }
    }),
    prisma.instanceAiEvent.findFirst({
      where: { session: s, event: "history_backfill" },
      orderBy: { createdAt: "desc" }
    })
  ]);

  const byKind = { question: 0, answer: 0, qa_pair: 0, other: 0 };
  for (const row of kindGroups) {
    const k = row.kind as keyof typeof byKind;
    if (k in byKind) byKind[k] = row._count.kind;
    else byKind.other += row._count.kind;
  }

  let queuePending = 0;
  let queueActive = 0;
  try {
    const q = await getAiQueueCounts();
    queuePending = q.pending;
    queueActive = q.active;
  } catch {
    /* Redis indisponível */
  }

  return {
    session: s,
    knowledgeItems,
    messagesLearned: distinctSources.length,
    byKind,
    learnedEvents,
    repliesToday,
    errorsRecent,
    queuePending,
    queueActive,
    lastBackfill: lastBackfillRow
      ? {
          at: lastBackfillRow.createdAt.toISOString(),
          detail: lastBackfillRow.detail ?? ""
        }
      : null
  };
}
