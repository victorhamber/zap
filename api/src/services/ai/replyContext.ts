import { prisma } from "../../prisma.js";
import { listStoredMessages } from "../inboxStore.js";
import { labelForMediaType } from "../mediaText.js";
import { expandChatIdVariants } from "../waLidMap.js";
import { getContactTagNames } from "../contacts.js";
import { phoneFromChatId } from "./tagGate.js";

const DEFAULT_HISTORY_LIMIT = 30;
const DEFAULT_KNOWLEDGE_LIMIT = 12;

function formatHistoryLine(fromMe: boolean, body: string, type: string): string {
  const speaker = fromMe ? "Atendente" : "Cliente";
  const text = body.trim() || labelForMediaType(type) || "(mensagem)";
  return `${speaker}: ${text}`;
}

export async function resolveLeadTagsForAi(chatId: string): Promise<string[]> {
  return getContactTagNames(phoneFromChatId(chatId));
}

export async function buildChatHistoryForAi(
  session: string,
  chatId: string,
  limit = DEFAULT_HISTORY_LIMIT
): Promise<string> {
  const { messages } = await listStoredMessages(chatId, limit, session);
  if (messages.length === 0) return "(sem histórico nesta conversa)";

  return messages.map((m) => formatHistoryLine(m.fromMe, m.body, m.type)).join("\n");
}

export async function fetchKnowledgeSnippetsForAi(
  session: string,
  chatId: string,
  limit = DEFAULT_KNOWLEDGE_LIMIT
): Promise<string[]> {
  if (!prisma) return [];

  const variants = await expandChatIdVariants(session, chatId);
  const rows = await prisma.instanceAiKnowledge.findMany({
    where: { session, chatId: { in: variants } },
    orderBy: { createdAt: "desc" },
    take: limit
  });

  return rows.map((k) => `[${k.kind}] ${k.topic ?? ""}: ${k.content}`);
}
