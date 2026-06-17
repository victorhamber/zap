import { prisma } from "../../prisma.js";
import { listStoredMessages, resolveAllChatIdsForContact } from "../inboxStore.js";
import { labelForMediaType } from "../mediaText.js";
import { getContactTagNames } from "../contacts.js";
import { phoneFromChatId } from "./tagGate.js";
import { buildChatContextForReply, refreshConversationMemory } from "./conversationMemory.js";

const DEFAULT_KNOWLEDGE_LIMIT = 6;

export async function resolveChatIdVariants(session: string, chatId: string): Promise<string[]> {
  return resolveAllChatIdsForContact(session, chatId);
}

export async function resolveLeadTagsForAi(chatId: string): Promise<string[]> {
  try {
    return await getContactTagNames(phoneFromChatId(chatId));
  } catch (err) {
    console.warn("[ai] resolveLeadTagsForAi failed", err);
    return [];
  }
}

export async function buildChatHistoryForAi(
  session: string,
  chatId: string,
  options?: { apiKey?: string; model?: string }
): Promise<string> {
  try {
    return await buildChatContextForReply({
      session,
      chatId,
      apiKey: options?.apiKey,
      model: options?.model
    });
  } catch (err) {
    console.warn("[ai] buildChatHistoryForAi failed", err);
    const { messages } = await listStoredMessages(chatId, 20, session);
    if (messages.length === 0) return "(sem histórico nesta conversa)";
    return messages
      .map((m) => {
        const speaker = m.fromMe ? "Atendente" : "Cliente";
        const text = m.body.trim() || labelForMediaType(m.type) || "(mensagem)";
        return `${speaker}: ${text}`;
      })
      .join("\n");
  }
}

export { refreshConversationMemory };

export async function fetchKnowledgeSnippetsForAi(
  session: string,
  chatId: string,
  limit = DEFAULT_KNOWLEDGE_LIMIT
): Promise<string[]> {
  if (!prisma) return [];

  try {
    const variants = await resolveAllChatIdsForContact(session, chatId);
    const rows = await prisma.instanceAiKnowledge.findMany({
      where: { session, chatId: { in: variants } },
      orderBy: { createdAt: "desc" },
      take: limit
    });
    return rows.map((k) => `[${k.kind}] ${k.topic ?? ""}: ${k.content}`);
  } catch (err) {
    console.warn("[ai] fetchKnowledgeSnippetsForAi failed", err);
    return [];
  }
}

export async function hasManualReplyAfterInbound(params: {
  session: string;
  chatId: string;
  inboundTimestamp: Date;
}): Promise<boolean> {
  if (!prisma) return false;
  const variants = await resolveAllChatIdsForContact(params.session, params.chatId);
  const row = await prisma.inboxMessage.findFirst({
    where: {
      session: params.session,
      chatId: { in: variants },
      fromMe: true,
      source: "manual",
      timestamp: { gt: params.inboundTimestamp }
    },
    select: { id: true }
  });
  return Boolean(row);
}

export async function hasAiReplyAfterInbound(params: {
  session: string;
  chatId: string;
  inboundTimestamp: Date;
}): Promise<boolean> {
  if (!prisma) return false;
  const variants = await resolveAllChatIdsForContact(params.session, params.chatId);
  const existing = await prisma.inboxMessage.findFirst({
    where: {
      session: params.session,
      chatId: { in: variants },
      fromMe: true,
      source: "ai",
      timestamp: { gte: params.inboundTimestamp }
    },
    select: { id: true }
  });
  return Boolean(existing);
}

/** Mensagens do cliente desde a última resposta nossa (ainda sem resposta). */
export async function collectInboundBatchForReply(params: {
  session: string;
  chatId: string;
  anchorInboundId: string;
}): Promise<{ combinedText: string; anchorTimestamp: Date }> {
  if (!prisma) {
    return { combinedText: "", anchorTimestamp: new Date() };
  }

  const anchor = await prisma.inboxMessage.findFirst({
    where: {
      session: params.session,
      OR: [{ id: params.anchorInboundId }, { waMessageId: params.anchorInboundId }]
    }
  });
  if (!anchor || anchor.fromMe) {
    return { combinedText: "", anchorTimestamp: new Date() };
  }

  const variants = await resolveAllChatIdsForContact(params.session, params.chatId);
  const lastOutbound = await prisma.inboxMessage.findFirst({
    where: {
      session: params.session,
      chatId: { in: variants },
      fromMe: true,
      timestamp: { lt: anchor.timestamp }
    },
    orderBy: { timestamp: "desc" }
  });

  const since =
    lastOutbound?.timestamp ?? new Date(anchor.timestamp.getTime() - 30 * 60_000);

  const inbounds = await prisma.inboxMessage.findMany({
    where: {
      session: params.session,
      chatId: { in: variants },
      fromMe: false,
      timestamp: { gte: since, lte: anchor.timestamp }
    },
    orderBy: { timestamp: "asc" }
  });

  const texts = inbounds.map((m) => m.body.trim()).filter(Boolean);
  const combinedText =
    texts.length <= 1
      ? texts[0] ?? anchor.body.trim()
      : texts.map((t, i) => `${i + 1}. ${t}`).join("\n");

  return { combinedText, anchorTimestamp: anchor.timestamp };
}

export async function getRecentAiReplies(
  session: string,
  chatId: string,
  limit = 3
): Promise<string[]> {
  if (!prisma) return [];
  const variants = await resolveAllChatIdsForContact(session, chatId);
  const rows = await prisma.inboxMessage.findMany({
    where: {
      session,
      chatId: { in: variants },
      fromMe: true,
      source: "ai"
    },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: { body: true }
  });
  return rows.map((r) => r.body.trim()).filter(Boolean);
}
