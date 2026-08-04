import type { InboxMessageSource } from "../../types/ai.js";
import { prisma } from "../../prisma.js";
import { expandPhoneLookupKeys } from "../../utils/phone.js";
import {
  contactHasLearnTags,
  isGroupChatId,
  phoneFromChatId
} from "./tagGate.js";
import { detectModality } from "./mediaExtract.js";
import { modalityAllowedForLearn, isHumanAnswerSource } from "./learnGate.js";
import {
  setChatModeHuman,
  resolveChatModeForInbound,
  setPendingReply,
  clearPendingReply,
  logAiEvent
} from "./chatState.js";
import {
  enqueueAiLearnJob,
  enqueueAiReplyJob,
  cancelAiReplyJob,
  aiReplyJobId
} from "../../queue.js";
import { getAiSettings } from "./settings.js";

/** Espera o download assíncrono da mídia antes de tentar aprender com ela. */
const MEDIA_LEARN_DELAY_MS = 20_000;

/** Serializa enqueue por chat — evita race setPending vs cancel. */
const enqueueLocks = new Map<string, Promise<void>>();

export type SavedInboxMessage = {
  id: string;
  session: string;
  chatId: string;
  fromMe: boolean;
  source: InboxMessageSource;
  type: string;
  body: string;
  waMessageId: string | null;
};

function modalityAllowed(
  modality: string,
  flags: {
    learnText: boolean;
    learnImage: boolean;
    learnAudio: boolean;
    learnVideo: boolean;
  }
): boolean {
  return modalityAllowedForLearn(modality, flags);
}

function lockKey(session: string, chatId: string): string {
  return `${session}::${chatId}`;
}

export function enqueueAiPipeline(msg: SavedInboxMessage): void {
  void runEnqueueSerialized(msg).catch((err) => {
    console.error("[ai] enqueue failed", err);
  });
}

async function runEnqueueSerialized(msg: SavedInboxMessage): Promise<void> {
  const key = lockKey(msg.session, msg.chatId);
  const prev = enqueueLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const chain = prev.then(() => gate);
  enqueueLocks.set(key, chain);
  await prev;
  try {
    await runEnqueue(msg);
  } finally {
    release();
    if (enqueueLocks.get(key) === chain) enqueueLocks.delete(key);
  }
}

/** Reprocessa a última mensagem inbound após tag aplicada no contato. */
export async function retryAiPipelineForContact(phone: string): Promise<void> {
  if (!prisma) return;

  const settings = await getAiSettings();
  if (!settings.learnEnabled && !settings.autoReplyEnabled) return;

  const keys = expandPhoneLookupKeys(phone.replace(/\D/g, ""));
  if (keys.length === 0) return;

  const session = settings.session;
  const lastInbound = await prisma.inboxMessage.findFirst({
    where: {
      session,
      fromMe: false,
      OR: keys.flatMap((k) => [
        { chatId: { startsWith: k } },
        { chatId: k }
      ])
    },
    orderBy: { timestamp: "desc" }
  });
  if (!lastInbound) return;

  await runEnqueueSerialized({
    id: lastInbound.id,
    session: lastInbound.session,
    chatId: lastInbound.chatId,
    fromMe: lastInbound.fromMe,
    source: lastInbound.source as InboxMessageSource,
    type: lastInbound.type,
    body: lastInbound.body,
    waMessageId: lastInbound.waMessageId
  });
}

/**
 * Depois de uma resposta (ou abort), se chegou inbound mais novo sem reply AI,
 * agenda de novo — cobre burst enquanto o job estava active.
 */
export async function drainNewerInboundForReply(params: {
  session: string;
  chatId: string;
  afterTimestamp: Date;
}): Promise<void> {
  if (!prisma) return;
  const newer = await prisma.inboxMessage.findFirst({
    where: {
      session: params.session,
      chatId: params.chatId,
      fromMe: false,
      timestamp: { gt: params.afterTimestamp }
    },
    orderBy: { timestamp: "desc" }
  });
  if (!newer) return;

  enqueueAiPipeline({
    id: newer.id,
    session: newer.session,
    chatId: newer.chatId,
    fromMe: newer.fromMe,
    source: newer.source as InboxMessageSource,
    type: newer.type,
    body: newer.body,
    waMessageId: newer.waMessageId
  });
}

async function runEnqueue(msg: SavedInboxMessage): Promise<void> {
  const settings = await getAiSettings(msg.session);
  if (!settings.learnEnabled && !settings.autoReplyEnabled) return;
  if (isGroupChatId(msg.chatId)) return;

  const phone = phoneFromChatId(msg.chatId);
  // Lista vazia = não filtra por tag (antes bloqueava 100% da IA).
  if (settings.learnTagIds.length > 0) {
    const hasTags = await contactHasLearnTags(phone, settings.learnTagIds);
    if (!hasTags) return;
  }

  const modality = detectModality(msg.type);
  const learnDelayMs = modality === "text" ? 0 : MEDIA_LEARN_DELAY_MS;

  if (settings.learnEnabled && modalityAllowed(modality, settings)) {
    if (!msg.fromMe) {
      await enqueueAiLearnJob(
        {
          session: msg.session,
          chatId: msg.chatId,
          inboxMessageId: msg.id,
          modality,
          kind: "question"
        },
        learnDelayMs
      );
    } else if (isHumanAnswerSource(msg.source)) {
      await enqueueAiLearnJob(
        {
          session: msg.session,
          chatId: msg.chatId,
          inboxMessageId: msg.id,
          modality,
          kind: "answer"
        },
        learnDelayMs
      );
    }
  }

  if (msg.fromMe && isHumanAnswerSource(msg.source)) {
    await setChatModeHuman(msg.session, msg.chatId);
    await cancelAiReplyJob(msg.session, msg.chatId);
    await clearPendingReply(msg.session, msg.chatId);
    return;
  }

  if (!settings.autoReplyEnabled || msg.fromMe) return;

  const mode = await resolveChatModeForInbound(
    msg.session,
    msg.chatId,
    settings.humanIdleSec,
    new Date()
  );
  if (mode === "human") return;

  if (modality === "video" && !settings.replyVideo) {
    await logAiEvent({
      session: msg.session,
      chatId: msg.chatId,
      event: "skipped_video",
      detail: "Vídeo recebido — aguardando atendimento humano"
    });
    return;
  }

  await cancelAiReplyJob(msg.session, msg.chatId);

  const inboundId = msg.id;
  const jobId = aiReplyJobId(msg.session, msg.chatId);
  await enqueueAiReplyJob(
    {
      session: msg.session,
      chatId: msg.chatId,
      inboundMessageId: inboundId,
      scheduledAt: new Date(Date.now() + settings.replyDelaySec * 1000).toISOString()
    },
    settings.replyDelaySec * 1000,
    jobId
  );
  await setPendingReply(msg.session, msg.chatId, inboundId, jobId);
}
