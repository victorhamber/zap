import type { InboxMessageSource } from "../../types/ai.js";
import { prisma } from "../../prisma.js";
import { expandPhoneLookupKeys } from "../../utils/phone.js";
import {
  contactHasLearnTags,
  isGroupChatId,
  phoneFromChatId
} from "./tagGate.js";
import { detectModality } from "./mediaExtract.js";
import { modalityAllowedForLearn } from "./learnGate.js";
import { setChatModeHuman, resolveChatModeForInbound, setPendingReply } from "./chatState.js";
import {
  enqueueAiLearnJob,
  enqueueAiReplyJob,
  cancelAiReplyJob,
  aiReplyJobId
} from "../../queue.js";
import { getAiSettings } from "./settings.js";

/** Espera o download assíncrono da mídia antes de tentar aprender com ela. */
const MEDIA_LEARN_DELAY_MS = 20_000;

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

export function enqueueAiPipeline(msg: SavedInboxMessage): void {
  void runEnqueue(msg).catch((err) => {
    console.error("[ai] enqueue failed", err);
  });
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

  await runEnqueue({
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

async function runEnqueue(msg: SavedInboxMessage): Promise<void> {
  const settings = await getAiSettings(msg.session);
  if (!settings.learnEnabled && !settings.autoReplyEnabled) return;
  if (isGroupChatId(msg.chatId)) return;

  const phone = phoneFromChatId(msg.chatId);
  const hasTags = await contactHasLearnTags(phone, settings.learnTagIds);
  if (!hasTags) return;

  const modality = detectModality(msg.type);
  // O download/descriptografia da mídia roda de forma assíncrona após salvar a
  // mensagem. Sem atraso, o job de aprendizado lia mediaUrl ainda nula e
  // aprendia o placeholder. Damos tempo para o download concluir.
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
    } else if (msg.source === "manual") {
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

  if (msg.fromMe && msg.source === "manual") {
    await setChatModeHuman(msg.session, msg.chatId);
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
