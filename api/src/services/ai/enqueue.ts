import type { InboxMessageSource } from "../../types/ai.js";
import { prisma } from "../../prisma.js";
import { expandPhoneLookupKeys } from "../../utils/phone.js";
import { resolveAllChatIdsForContact } from "../inboxStore.js";
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
  findChatState,
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
 * agenda de novo — cobre burst enquanto o job estava active e jobId preso.
 */
export async function drainNewerInboundForReply(params: {
  session: string;
  chatId: string;
  afterTimestamp: Date;
  /** Se pending apontava para outra msg enquanto o job rodava. */
  preferredInboundId?: string | null;
}): Promise<void> {
  if (!prisma) return;

  if (params.preferredInboundId) {
    const preferred = await prisma.inboxMessage.findFirst({
      where: {
        session: params.session,
        OR: [
          { id: params.preferredInboundId },
          { waMessageId: params.preferredInboundId }
        ]
      }
    });
    if (preferred && !preferred.fromMe) {
      enqueueAiPipeline({
        id: preferred.id,
        session: preferred.session,
        chatId: preferred.chatId,
        fromMe: preferred.fromMe,
        source: preferred.source as InboxMessageSource,
        type: preferred.type,
        body: preferred.body,
        waMessageId: preferred.waMessageId
      });
      return;
    }
  }

  const variants = await resolveAllChatIdsForContact(params.session, params.chatId);
  const newer = await prisma.inboxMessage.findFirst({
    where: {
      session: params.session,
      chatId: { in: variants },
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

/**
 * Limpa pending do job atual sem apagar um pending mais novo; depois drena.
 */
export async function finishReplyScheduling(params: {
  session: string;
  chatId: string;
  answeredInboundId: string;
  afterTimestamp: Date;
}): Promise<void> {
  const state = await findChatState(params.session, params.chatId);
  const preferred =
    state?.pendingInboundId && state.pendingInboundId !== params.answeredInboundId
      ? state.pendingInboundId
      : null;
  await clearPendingReply(params.session, params.chatId);
  await drainNewerInboundForReply({
    session: params.session,
    chatId: params.chatId,
    afterTimestamp: params.afterTimestamp,
    preferredInboundId: preferred
  });
}

/** Eco fromMe da Evolution de um reply AI/flow recente — não é atendente humano. */
async function isLikelyAiOrFlowEcho(msg: SavedInboxMessage): Promise<boolean> {
  if (!prisma || !msg.fromMe) return false;
  const text = msg.body.trim();
  if (!msg.waMessageId && text.length < 8) return false;

  const variants = await resolveAllChatIdsForContact(msg.session, msg.chatId);
  const since = new Date(Date.now() - 180_000);
  const twin = await prisma.inboxMessage.findFirst({
    where: {
      session: msg.session,
      chatId: { in: variants },
      fromMe: true,
      source: { in: ["ai", "flow"] },
      timestamp: { gte: since },
      OR: [
        ...(msg.waMessageId ? [{ waMessageId: msg.waMessageId }] : []),
        ...(text.length >= 8 ? [{ body: text }] : [])
      ]
    },
    select: { id: true }
  });
  return Boolean(twin);
}

async function runEnqueue(msg: SavedInboxMessage): Promise<void> {
  const settings = await getAiSettings(msg.session);
  if (!settings.learnEnabled && !settings.autoReplyEnabled) return;
  if (isGroupChatId(msg.chatId)) return;

  const phone = phoneFromChatId(msg.chatId);
  const modality = detectModality(msg.type);
  const learnDelayMs = modality === "text" ? 0 : MEDIA_LEARN_DELAY_MS;

  // Aprendizado: filtro próprio por learnTagIds
  if (settings.learnEnabled && modalityAllowed(modality, settings)) {
    const learnOk =
      settings.learnTagIds.length === 0
        ? true
        : await contactHasLearnTags(phone, settings.learnTagIds);
    if (learnOk) {
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
  }

  if (msg.fromMe && isHumanAnswerSource(msg.source)) {
    // Eco Evolution do reply da IA (source webhook) não deve armar modo humano.
    if (await isLikelyAiOrFlowEcho(msg)) {
      return;
    }
    await setChatModeHuman(msg.session, msg.chatId);
    await cancelAiReplyJob(msg.session, msg.chatId);
    await clearPendingReply(msg.session, msg.chatId);
    return;
  }

  if (!settings.autoReplyEnabled || msg.fromMe) return;

  // Auto-resposta: filtro próprio por replyTagIds (independente do aprendizado)
  if (settings.replyTagIds.length > 0) {
    const replyOk = await contactHasLearnTags(phone, settings.replyTagIds);
    if (!replyOk) return;
  }

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
  const job = await enqueueAiReplyJob(
    {
      session: msg.session,
      chatId: msg.chatId,
      inboundMessageId: inboundId,
      scheduledAt: new Date(Date.now() + settings.replyDelaySec * 1000).toISOString()
    },
    settings.replyDelaySec * 1000,
    jobId
  );
  // Mesmo se o job atual está active (job=null), grava pending para o drain
  // reagendar esta mensagem quando o job terminar.
  await setPendingReply(msg.session, msg.chatId, inboundId, jobId);
  if (!job) {
    await logAiEvent({
      session: msg.session,
      chatId: msg.chatId,
      event: "reply_deferred",
      detail: `Reply em andamento — msg ${inboundId} fica na fila do drain`
    });
  }
}
