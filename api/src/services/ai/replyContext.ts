import { prisma } from "../../prisma.js";
import { listStoredMessages } from "../inboxStore.js";
import { labelForMediaType } from "../mediaText.js";
import { expandChatIdVariants } from "../waLidMap.js";
import { getContactTagNames } from "../contacts.js";
import { phoneFromChatId } from "./tagGate.js";
import { buildCompactChatContext } from "./conversationSummary.js";

const DEFAULT_KNOWLEDGE_LIMIT = 6;

export async function resolveChatIdVariants(session: string, chatId: string): Promise<string[]> {
  return expandChatIdVariants(session, chatId);
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
    return await buildCompactChatContext({
      session,
      chatId,
      apiKey: options?.apiKey,
      model: options?.model
    });
  } catch (err) {
    console.warn("[ai] buildChatHistoryForAi failed", err);
    const { messages } = await listStoredMessages(chatId, 12, session);
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

export async function fetchKnowledgeSnippetsForAi(
  session: string,
  chatId: string,
  limit = DEFAULT_KNOWLEDGE_LIMIT
): Promise<string[]> {
  if (!prisma) return [];

  try {
    const variants = await expandChatIdVariants(session, chatId);
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
  const variants = await expandChatIdVariants(params.session, params.chatId);
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
  const variants = await expandChatIdVariants(params.session, params.chatId);
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
