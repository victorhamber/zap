import type { InboxMessageSource } from "../../types/ai.js";

export function knowledgeSourceMsgId(msg: {
  id: string;
  waMessageId: string | null;
}): string {
  return msg.waMessageId ?? `inbox:${msg.id}`;
}

export function modalityAllowedForLearn(
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

/** Respostas humanas no histórico (inclui webhook = operador pelo celular). */
export function isHumanAnswerSource(source: string): boolean {
  return source === "manual" || source === "webhook";
}

export function learnKindForHistoryMessage(msg: {
  fromMe: boolean;
  source: string;
}): "question" | "answer" | null {
  if (!msg.fromMe) return "question";
  if (isHumanAnswerSource(msg.source as InboxMessageSource)) return "answer";
  return null;
}
