import { env } from "../../env.js";
import { prisma } from "../../prisma.js";
import { enqueueAiLearnJob } from "../../queue.js";
import { detectModality } from "./mediaExtract.js";
import {
  contactHasLearnTags,
  isGroupChatId,
  phoneFromChatId
} from "./tagGate.js";
import {
  knowledgeSourceMsgId,
  learnKindForHistoryMessage,
  modalityAllowedForLearn
} from "./learnGate.js";
import { logAiEvent } from "./chatState.js";
import { resolveOpenAiApiKey } from "./settings.js";

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

function learnStaggerMs(): number {
  return env.AI_LEARN_STAGGER_MS;
}

export type HistoryLearnResult = {
  queued: number;
  skipped: number;
  chats: number;
  scanned: number;
};

export async function queueHistoryLearning(params: {
  session: string;
  limit?: number;
}): Promise<HistoryLearnResult> {
  if (!prisma) throw new Error("Banco indisponível");

  const session = params.session.trim().toLowerCase();
  const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));

  const settings = await prisma.instanceAiSettings.findUnique({ where: { session } });
  if (!settings?.learnEnabled) {
    throw new Error("Ative o aprendizado antes de extrair do histórico");
  }
  if (settings.learnTagIds.length === 0) {
    throw new Error("Selecione ao menos uma tag para o aprendizado");
  }
  if (!(await resolveOpenAiApiKey(session))) {
    throw new Error("Configure a chave OpenAI desta instância");
  }

  const learnedRows = await prisma.instanceAiKnowledge.findMany({
    where: { session },
    select: { sourceMsgId: true }
  });
  const learnedIds = new Set(
    learnedRows.map((r) => r.sourceMsgId).filter((id): id is string => Boolean(id))
  );

  const chatRows = await prisma.inboxMessage.findMany({
    where: { session },
    distinct: ["chatId"],
    select: { chatId: true }
  });

  const tagCache = new Map<string, boolean>();
  async function hasTags(chatId: string): Promise<boolean> {
    if (isGroupChatId(chatId)) return false;
    const phone = phoneFromChatId(chatId);
    if (!phone) return false;
    if (tagCache.has(phone)) return tagCache.get(phone)!;
    const ok = await contactHasLearnTags(phone, settings!.learnTagIds);
    tagCache.set(phone, ok);
    return ok;
  }

  const modalityFlags = {
    learnText: settings.learnText,
    learnImage: settings.learnImage,
    learnAudio: settings.learnAudio,
    learnVideo: settings.learnVideo
  };

  let queued = 0;
  let skipped = 0;
  let scanned = 0;
  let chats = 0;

  for (const { chatId } of chatRows) {
    if (queued >= limit) break;
    if (!(await hasTags(chatId))) continue;
    chats++;

    const messages = await prisma.inboxMessage.findMany({
      where: { session, chatId },
      orderBy: { timestamp: "asc" }
    });

    for (const msg of messages) {
      if (queued >= limit) break;
      scanned++;

      const dedupeId = knowledgeSourceMsgId(msg);
      if (learnedIds.has(dedupeId)) {
        skipped++;
        continue;
      }

      const kind = learnKindForHistoryMessage(msg);
      if (!kind) {
        skipped++;
        continue;
      }

      const modality = detectModality(msg.type);
      if (!modalityAllowedForLearn(modality, modalityFlags)) {
        skipped++;
        continue;
      }

      await enqueueAiLearnJob(
        {
          session,
          chatId: msg.chatId,
          inboxMessageId: msg.id,
          modality,
          kind
        },
        queued * learnStaggerMs()
      );

      learnedIds.add(dedupeId);
      queued++;
    }
  }

  await logAiEvent({
    session,
    event: "history_backfill",
    detail: `${queued} enfileirados, ${skipped} ignorados, ${chats} chats`
  });

  return { queued, skipped, chats, scanned };
}
