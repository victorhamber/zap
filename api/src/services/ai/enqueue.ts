import type { InboxMessageSource } from "../../types/ai.js";
import { getAiSettings } from "./settings.js";
import {
  contactHasLearnTags,
  isGroupChatId,
  phoneFromChatId
} from "./tagGate.js";
import { detectModality } from "./mediaExtract.js";
import { setChatModeHuman, resolveChatModeForInbound, setPendingReply } from "./chatState.js";
import {
  enqueueAiLearnJob,
  enqueueAiReplyJob,
  cancelAiReplyJob,
  aiReplyJobId
} from "../../queue.js";

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
  if (modality === "text" || modality === "chat") return flags.learnText;
  if (modality === "image") return flags.learnImage;
  if (modality === "audio") return flags.learnAudio;
  if (modality === "video") return flags.learnVideo;
  return flags.learnText;
}

export function enqueueAiPipeline(msg: SavedInboxMessage): void {
  void runEnqueue(msg).catch((err) => {
    console.error("[ai] enqueue failed", err);
  });
}

async function runEnqueue(msg: SavedInboxMessage): Promise<void> {
  const settings = await getAiSettings(msg.session);
  if (!settings.enabled) return;
  if (isGroupChatId(msg.chatId)) return;

  const phone = phoneFromChatId(msg.chatId);
  const hasTags = await contactHasLearnTags(phone, settings.learnTagIds);
  if (!hasTags) return;

  const modality = detectModality(msg.type);

  if (settings.learnEnabled && modalityAllowed(modality, settings)) {
    if (!msg.fromMe) {
      await enqueueAiLearnJob({
        session: msg.session,
        chatId: msg.chatId,
        inboxMessageId: msg.id,
        modality,
        kind: "question"
      });
    } else if (msg.source === "manual") {
      await enqueueAiLearnJob({
        session: msg.session,
        chatId: msg.chatId,
        inboxMessageId: msg.id,
        modality,
        kind: "answer"
      });
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
    settings.humanIdleSec
  );
  if (mode === "human") return;

  await cancelAiReplyJob(msg.session, msg.chatId);

  const inboundId = msg.waMessageId ?? msg.id;
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
