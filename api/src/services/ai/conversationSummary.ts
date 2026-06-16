import { prisma } from "../../prisma.js";
import { listStoredMessages } from "../inboxStore.js";
import { labelForMediaType } from "../mediaText.js";
import { openaiChat } from "./openaiClient.js";
import { findChatState, saveConversationSummary } from "./chatState.js";

const RECENT_MSG_COUNT = 8;
const SUMMARY_MIN_MESSAGES = 14;
const SUMMARY_REFRESH_MSGS = 6;

function formatLine(fromMe: boolean, body: string, type: string): string {
  const speaker = fromMe ? "Atendente" : "Cliente";
  const text = body.trim() || labelForMediaType(type) || "(mensagem)";
  return `${speaker}: ${text}`;
}

export async function buildCompactChatContext(params: {
  session: string;
  chatId: string;
  apiKey?: string;
  model?: string;
}): Promise<string> {
  const { messages } = await listStoredMessages(params.chatId, 40, params.session);
  if (messages.length === 0) return "(sem histórico nesta conversa)";

  const recent = messages.slice(-RECENT_MSG_COUNT);
  const recentText = recent.map((m) => formatLine(m.fromMe, m.body, m.type)).join("\n");

  if (messages.length <= RECENT_MSG_COUNT) {
    return recentText;
  }

  const state = await findChatState(params.session, params.chatId);
  const olderCount = messages.length - RECENT_MSG_COUNT;
  const needsRefresh =
    !state?.conversationSummary?.trim() ||
    olderCount - (state.summaryMessageCount ?? 0) >= SUMMARY_REFRESH_MSGS;

  let summary = state?.conversationSummary?.trim() ?? "";

  if (needsRefresh && params.apiKey && params.model && messages.length >= SUMMARY_MIN_MESSAGES) {
    const toSummarize = messages.slice(0, -RECENT_MSG_COUNT);
    const lines = toSummarize.map((m) => formatLine(m.fromMe, m.body, m.type)).join("\n");
    try {
      const { text } = await openaiChat({
        apiKey: params.apiKey,
        model: params.model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "Resuma conversas de atendimento WhatsApp em português. Inclua: o que o cliente já sabe, ofertas já feitas, compras/status, dúvidas em aberto. Máximo 350 palavras. Não invente fatos."
          },
          {
            role: "user",
            content: `Resumo anterior:\n${summary || "(nenhum)"}\n\nMensagens:\n${lines.slice(0, 8000)}\n\nResumo atualizado:`
          }
        ]
      });
      summary = text.trim().slice(0, 2500);
      await saveConversationSummary(params.session, params.chatId, summary, olderCount);
    } catch (err) {
      console.warn("[ai] conversation summary failed", err);
      if (!summary) summary = lines.slice(0, 2000);
    }
  }

  if (summary) {
    return `Resumo das mensagens anteriores:\n${summary}\n\nÚltimas mensagens:\n${recentText}`;
  }

  return recentText;
}
