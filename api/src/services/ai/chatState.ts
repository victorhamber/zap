import { prisma } from "../../prisma.js";
import { cancelAiReplyJob, aiReplyJobId } from "../../queue.js";

export type ChatMode = "auto" | "human";

export async function getChatState(session: string, chatId: string) {
  if (!prisma) return null;
  return prisma.instanceAiChatState.findUnique({
    where: { session_chatId: { session, chatId } }
  });
}

export async function setChatModeHuman(session: string, chatId: string): Promise<void> {
  if (!prisma) return;
  await cancelAiReplyJob(session, chatId);
  await prisma.instanceAiChatState.upsert({
    where: { session_chatId: { session, chatId } },
    create: {
      session,
      chatId,
      mode: "human",
      lastHumanAt: new Date(),
      pendingReplyJobId: null,
      pendingInboundId: null
    },
    update: {
      mode: "human",
      lastHumanAt: new Date(),
      pendingReplyJobId: null,
      pendingInboundId: null
    }
  });
}

export async function resolveChatModeForInbound(
  session: string,
  chatId: string,
  humanIdleSec: number
): Promise<ChatMode> {
  if (!prisma) return "auto";
  const state = await getChatState(session, chatId);
  if (!state || state.mode !== "human") return "auto";

  const last = state.lastHumanAt?.getTime() ?? 0;
  const idleMs = humanIdleSec * 1000;
  if (Date.now() - last >= idleMs) {
    await prisma.instanceAiChatState.update({
      where: { session_chatId: { session, chatId } },
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
  await prisma.instanceAiChatState.upsert({
    where: { session_chatId: { session, chatId } },
    create: {
      session,
      chatId,
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
  await prisma.instanceAiChatState.updateMany({
    where: { session, chatId },
    data: { pendingReplyJobId: null, pendingInboundId: null }
  });
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
