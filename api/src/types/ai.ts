export type InboxMessageSource = "webhook" | "manual" | "flow" | "ai";

export type OfficialLink = {
  trigger: string;
  url: string;
  label: string;
};

export type AiLearnJobPayload = {
  session: string;
  chatId: string;
  inboxMessageId: string;
  modality: string;
  kind: "question" | "answer";
};

export type AiReplyJobPayload = {
  session: string;
  chatId: string;
  inboundMessageId: string;
  scheduledAt: string;
};

export type AiJobPayload = AiLearnJobPayload | AiReplyJobPayload;

export type LearnExtraction = {
  topic: string;
  summary: string;
  qaPair?: { question: string; answerBase: string };
};
