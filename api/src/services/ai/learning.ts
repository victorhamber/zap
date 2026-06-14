import { prisma } from "../../prisma.js";
import type { AiLearnJobPayload } from "../../types/ai.js";
import { resolveOpenAiApiKey } from "./settings.js";
import { extractKnowledge } from "./openaiClient.js";
import { extractTextFromMessage } from "./mediaExtract.js";
import { logAiEvent } from "./chatState.js";

const QA_WINDOW_MS = 30 * 60 * 1000;

export async function processLearnJob(payload: AiLearnJobPayload): Promise<void> {
  if (!prisma) return;

  const settings = await prisma.instanceAiSettings.findUnique({
    where: { session: payload.session }
  });
  if (!settings?.enabled || !settings.learnEnabled) return;

  const msg = await prisma.inboxMessage.findUnique({
    where: { id: payload.inboxMessageId }
  });
  if (!msg || msg.session !== payload.session) return;

  if (msg.waMessageId) {
    const dup = await prisma.instanceAiKnowledge.findFirst({
      where: { session: payload.session, sourceMsgId: msg.waMessageId }
    });
    if (dup) return;
  }

  const apiKey = await resolveOpenAiApiKey(payload.session);
  if (!apiKey) {
    await logAiEvent({
      session: payload.session,
      chatId: payload.chatId,
      event: "error",
      detail: "Chave OpenAI não configurada nesta instância"
    });
    return;
  }

  let text = msg.body;
  try {
    const extracted = await extractTextFromMessage({
      session: payload.session,
      message: msg,
      modality: payload.modality,
      flags: {
        text: settings.learnText,
        image: settings.learnImage,
        audio: settings.learnAudio,
        video: settings.learnVideo
      },
      settings,
      apiKey
    });
    if (extracted) text = extracted;
  } catch (err) {
    await logAiEvent({
      session: payload.session,
      chatId: payload.chatId,
      event: "error",
      detail: `mediaExtract: ${err instanceof Error ? err.message : String(err)}`
    });
  }

  if (!text.trim()) return;

  let priorQuestion: string | undefined;
  if (payload.kind === "answer") {
    const lastInbound = await prisma.inboxMessage.findFirst({
      where: {
        session: payload.session,
        chatId: msg.chatId,
        fromMe: false,
        timestamp: { gte: new Date(Date.now() - QA_WINDOW_MS) }
      },
      orderBy: { timestamp: "desc" }
    });
    priorQuestion = lastInbound?.body;
  }

  const extraction = await extractKnowledge({
    apiKey,
    model: settings.modelChat,
    messageText: text,
    productContext: settings.productContext,
    priorQuestion,
    kind: payload.kind
  });

  const sourceMsgId = msg.waMessageId;

  if (payload.kind === "question") {
    await prisma.instanceAiKnowledge.create({
      data: {
        session: payload.session,
        chatId: payload.chatId,
        kind: "question",
        topic: extraction.topic,
        content: extraction.summary,
        sourceMsgId,
        modality: payload.modality
      }
    });
  } else {
    await prisma.instanceAiKnowledge.create({
      data: {
        session: payload.session,
        chatId: payload.chatId,
        kind: "answer",
        topic: extraction.topic,
        content: extraction.summary,
        sourceMsgId,
        modality: payload.modality
      }
    });

    if (extraction.qaPair?.question && extraction.qaPair.answerBase) {
      await prisma.instanceAiKnowledge.create({
        data: {
          session: payload.session,
          chatId: payload.chatId,
          kind: "qa_pair",
          topic: extraction.topic,
          content: JSON.stringify(extraction.qaPair),
          sourceMsgId,
          modality: payload.modality
        }
      });
    } else if (priorQuestion) {
      await prisma.instanceAiKnowledge.create({
        data: {
          session: payload.session,
          chatId: payload.chatId,
          kind: "qa_pair",
          topic: extraction.topic,
          content: JSON.stringify({ question: priorQuestion, answerBase: extraction.summary }),
          sourceMsgId,
          modality: payload.modality
        }
      });
    }
  }

  await logAiEvent({
    session: payload.session,
    chatId: payload.chatId,
    event: "learned",
    detail: `${payload.kind}:${extraction.topic}`
  });
}
