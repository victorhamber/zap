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

/**
 * Fontes de mensagem que representam um ATENDENTE humano respondendo:
 * "manual" = pelo painel; "webhook" = pelo próprio WhatsApp (celular).
 * A resposta da IA usa "ai" e mensagens de fluxo usam "flow" — nenhuma entra aqui.
 * Exportado como const para reuso em filtros Prisma (`source: { in: HUMAN_ANSWER_SOURCES }`).
 */
export const HUMAN_ANSWER_SOURCES = ["manual", "webhook"] as const;

export function isHumanAnswerSource(source: string): boolean {
  return (HUMAN_ANSWER_SOURCES as readonly string[]).includes(source);
}

export function learnKindForHistoryMessage(msg: {
  fromMe: boolean;
  source: string;
}): "question" | "answer" | null {
  if (!msg.fromMe) return "question";
  if (isHumanAnswerSource(msg.source as InboxMessageSource)) return "answer";
  return null;
}
