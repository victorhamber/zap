import { prisma } from "../../prisma.js";
import { resolveAllChatIdsForContact, canonicalizeChatId } from "../inboxStore.js";
import { cancelAiReplyJob, aiReplyJobId } from "../../queue.js";

export type ChatMode = "auto" | "human";

export async function resolveCanonicalChatId(session: string, chatId: string): Promise<string> {
  return canonicalizeChatId(session, chatId);
}

export async function findChatState(session: string, chatId: string) {
  if (!prisma) return null;
  const variants = await resolveAllChatIdsForContact(session, chatId);
  return prisma.instanceAiChatState.findFirst({
    where: { session, chatId: { in: variants } },
    orderBy: { lastHumanAt: "desc" }
  });
}

export async function getChatState(session: string, chatId: string) {
  return findChatState(session, chatId);
}

export async function setChatModeAuto(session: string, chatId: string): Promise<void> {
  if (!prisma) return;
  const canonical = await resolveCanonicalChatId(session, chatId);
  await prisma.instanceAiChatState.upsert({
    where: { session_chatId: { session, chatId: canonical } },
    create: { session, chatId: canonical, mode: "auto" },
    update: { mode: "auto", lastHumanAt: null }
  });
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

  // O modo humano dura até passar `humanIdleSec` desde a ÚLTIMA ação do
  // atendente. Antes havia uma reversão extra: qualquer mensagem do cliente mais
  // nova que a última ação humana voltava o chat para "auto" na hora — o que
  // tornava humanIdleSec inútil, porque a resposta é sempre disparada por uma
  // mensagem nova do cliente. Agora só o tempo de inatividade decide. O reset
  // acontece naturalmente: quando o cliente escreve depois da janela, esta mesma
  // função devolve "auto". `inboundTimestamp` fica para diagnóstico futuro.
  void inboundTimestamp;

  // Eco Evolution já armou human no passado: se o "humano" coincide com reply AI
  // e não houve resposta manual no painel, libera.
  if (state.lastHumanAt) {
    const variants = await resolveAllChatIdsForContact(session, chatId);
    const around = state.lastHumanAt.getTime();
    const window = {
      gte: new Date(around - 30_000),
      lte: new Date(around + 30_000)
    };
    const aiNear = await prisma.inboxMessage.findFirst({
      where: {
        session,
        chatId: { in: variants },
        fromMe: true,
        source: { in: ["ai", "flow"] },
        timestamp: window
      },
      select: { id: true }
    });
    if (aiNear) {
      const manualNear = await prisma.inboxMessage.findFirst({
        where: {
          session,
          chatId: { in: variants },
          fromMe: true,
          source: "manual",
          timestamp: window
        },
        select: { id: true }
      });
      if (!manualNear) {
        await prisma.instanceAiChatState.update({
          where: { session_chatId: { session: state.session, chatId: state.chatId } },
          data: { mode: "auto" }
        });
        return "auto";
      }
    }
  }

  const last = state.lastHumanAt?.getTime() ?? 0;
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
  const variants = await resolveAllChatIdsForContact(session, chatId);
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
