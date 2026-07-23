export type InboxMessageSource = "webhook" | "manual" | "flow" | "ai";

export type OfficialLink = {
  trigger: string;
  url: string;
  label: string;
};

/** Resposta pronta (texto + mídia opcional) que a IA dispara ao reconhecer a pergunta. */
export type AiMediaResponseKind = "text" | "image" | "video" | "audio" | "document";

export type AiMediaResponse = {
  id: string;
  /** Nome interno para o painel (ex.: "Tutorial de instalação"). */
  label: string;
  /** Perguntas-gatilho e variações. A IA casa por intenção, não por texto exato. */
  triggers: string[];
  /** Texto enviado (opcional). Vira legenda quando há mídia. */
  text: string;
  kind: AiMediaResponseKind;
  /** Vazio para kind "text". */
  mediaUrl: string;
  filename: string;
  enabled: boolean;
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
