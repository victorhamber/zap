import { prisma } from "../../prisma.js";
import { expandChatIdVariants } from "../waLidMap.js";
import { cancelAiReplyJob, aiReplyJobId } from "../../queue.js";

export type ChatMode = "auto" | "human";

export async function resolveCanonicalChatId(session: string, chatId: string): Promise<string> {
  const variants = await expandChatIdVariants(session, chatId);
  return (
    variants.find((v) => v.endsWith("@s.whatsapp.net")) ??
    variants.find((v) => v.endsWith("@c.us")) ??
    variants[0] ??
    chatId
  );
}

export async function findChatState(session: string, chatId: string) {
  if (!prisma) return null;
  const variants = await expandChatIdVariants(session, chatId);
  return prisma.instanceAiChatState.findFirst({
    where: { session, chatId: { in: variants } },
    orderBy: { lastHumanAt: "desc" }
  });
}

export async function getChatState(session: string, chatId: string) {
  return findChatState(session, chatId);
}

export async function setChatModeHuman(session: string, chatId: string): Promise<void> {
  if (!prisma) return;
  const canonical = await resolveCanonicalChatId(session, chatId);
  await prisma.instanceAiChatState.upsert({
    where: { session_chatId: { session, chatId: canonical } },
    create: {
      session,
      chatId: canonical,
      mode: "human",
      lastHumanAt: new Date()
    },
    update: {
      mode: "human",
      lastHumanAt: new Date()
    }
  });
}

export async function resolveChatModeForInbound(
  session: string,
  chatId: string,
  humanIdleSec: number,
  inboundTimestamp?: Date
): Promise<ChatMode> {
  if (!prisma) return "auto";
  const state = await findChatState(session, chatId);
  if (!state || state.mode !== "human") return "auto";

  const lastHuman = state.lastHumanAt;
  if (inboundTimestamp && lastHuman && inboundTimestamp > lastHuman) {
    await prisma.instanceAiChatState.update({
      where: { session_chatId: { session: state.session, chatId: state.chatId } },
      data: { mode: "auto" }
    });
    return "auto";
  }

  const last = lastHuman?.getTime() ?? 0;
  const idleMs = humanIdleSec * 1000;
  if (Date.now() - last >= idleMs) {
    await prisma.instanceAiChatState.update({
      where: { session_chatId: { session: state.session, chatId: state.chatId } },
      data: { mode: "auto" }
    });
    return "auto";
  }
  return "human";
}

export async function setPendingReply(
  session: string,
  chatId: string,
  inboundMessageId: string,
  bullJobId: string
): Promise<void> {
  if (!prisma) return;
  const canonical = await resolveCanonicalChatId(session, chatId);
  await prisma.instanceAiChatState.upsert({
    where: { session_chatId: { session, chatId: canonical } },
    create: {
      session,
      chatId: canonical,
      mode: "auto",
      pendingReplyJobId: bullJobId,
      pendingInboundId: inboundMessageId
    },
    update: {
      pendingReplyJobId: bullJobId,
      pendingInboundId: inboundMessageId
    }
  });
}

export async function clearPendingReply(session: string, chatId: string): Promise<void> {
  if (!prisma) return;
  const variants = await expandChatIdVariants(session, chatId);
  await prisma.instanceAiChatState.updateMany({
    where: { session, chatId: { in: variants } },
    data: { pendingReplyJobId: null, pendingInboundId: null }
  });
}

export async function saveConversationMemory(
  session: string,
  chatId: string,
  memory: string,
  memoryLastMessageId: string | null,
  summarizedCount: number
): Promise<void> {
  if (!prisma) return;
  const canonical = await resolveCanonicalChatId(session, chatId);
  await prisma.instanceAiChatState.upsert({
    where: { session_chatId: { session, chatId: canonical } },
    create: {
      session,
      chatId: canonical,
      conversationSummary: memory,
      summaryMessageCount: summarizedCount,
      summaryUpdatedAt: new Date(),
      memoryLastMessageId
    },
    update: {
      conversationSummary: memory,
      summaryMessageCount: summarizedCount,
      summaryUpdatedAt: new Date(),
      memoryLastMessageId
    }
  });
}

/** @deprecated use saveConversationMemory */
export async function saveConversationSummary(
  session: string,
  chatId: string,
  summary: string,
  messageCount: number
): Promise<void> {
  await saveConversationMemory(session, chatId, summary, null, messageCount);
}

export function expectedReplyJobId(session: string, chatId: string): string {
  return aiReplyJobId(session, chatId);
}

export async function logAiEvent(params: {
  session: string;
  chatId?: string;
  event: string;
  detail?: string;
}): Promise<void> {
  if (!prisma) return;
  await prisma.instanceAiEvent.create({
    data: {
      session: params.session,
      chatId: params.chatId ?? null,
      event: params.event,
      detail: params.detail?.slice(0, 4000) ?? null
    }
  });
}

export async function countDailyReplies(session: string): Promise<number> {
  if (!prisma) return 0;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return prisma.instanceAiEvent.count({
    where: { session, event: "replied", createdAt: { gte: start } }
  });
}

// cancelAiReplyJob ainda usado em outros fluxos
export { cancelAiReplyJob };
