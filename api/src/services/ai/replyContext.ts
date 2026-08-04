import { prisma } from "../../prisma.js";
import { listStoredMessages, resolveAllChatIdsForContact } from "../inboxStore.js";
import { labelForMediaType } from "../mediaText.js";
import { getContactTagNames } from "../contacts.js";
import { phoneFromChatId } from "./tagGate.js";
import { HUMAN_ANSWER_SOURCES } from "./learnGate.js";
import { buildChatContextForReply, refreshConversationMemory } from "./conversationMemory.js";

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
  options?: { inboundText?: string; limit?: number }
): Promise<string[]> {
  try {
    const { fetchSessionKnowledgeForReply } = await import("./knowledgeRetrieval.js");
    return fetchSessionKnowledgeForReply({
      session,
      chatId,
      inboundText: options?.inboundText,
      limit: options?.limit
    });
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
      // "manual" (painel) OU "webhook" (celular). Antes só "manual", então o
      // atendente que respondia pelo aparelho não cancelava a resposta da IA.
      source: { in: [...HUMAN_ANSWER_SOURCES] },
      timestamp: { gt: params.inboundTimestamp }
    },
    select: { id: true, body: true, waMessageId: true }
  });
  if (!row) return false;

  // Eco da Evolution (fromMe webhook) do próprio reply AI não conta como humano.
  const text = row.body.trim();
  if (text.length >= 8 || row.waMessageId) {
    const aiTwin = await prisma.inboxMessage.findFirst({
      where: {
        session: params.session,
        chatId: { in: variants },
        fromMe: true,
        source: { in: ["ai", "flow"] },
        timestamp: {
          gte: new Date(params.inboundTimestamp.getTime() - 120_000)
        },
        OR: [
          ...(row.waMessageId ? [{ waMessageId: row.waMessageId }] : []),
          ...(text.length >= 8 ? [{ body: text }] : [])
        ]
      },
      select: { id: true }
    });
    if (aiTwin) return false;
  }
  return true;
}

/**
 * True se já existe reply AI que cobre este inbound.
 * Depende do timestamp da mensagem AI (âncora do job + 1ms), não do wall-clock
 * do fim do Whisper/GPT — senão msgs que chegaram DURANTE o job eram abortadas.
 */
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
      timestamp: { gt: params.inboundTimestamp }
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
