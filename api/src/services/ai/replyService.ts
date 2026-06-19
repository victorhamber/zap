import { prisma } from "../../prisma.js";
import type { AiReplyJobPayload } from "../../types/ai.js";
import { saveInboxMessage } from "../inboxStore.js";
import { sendText } from "../whatsapp/index.js";
import { getAiSettings, resolveOpenAiApiKey } from "./settings.js";
import {
  buildSystemPrompt,
  validateReplyAgainstRules,
  injectOfficialLinksHint,
  isRepetitiveReply
} from "./rulesEngine.js";
import { buildOfficialFactsBlock } from "./knowledgeRetrieval.js";
import { generateReply } from "./openaiClient.js";
import {
  clearPendingReply,
  countDailyReplies,
  findChatState,
  logAiEvent,
  resolveChatModeForInbound
} from "./chatState.js";
import { extractInboundTextForReply } from "./mediaExtract.js";
import { phoneFromChatId } from "./tagGate.js";
import { findContactByPhoneLoose } from "../contacts.js";
import {
  buildChatHistoryForAi,
  collectInboundBatchForReply,
  fetchKnowledgeSnippetsForAi,
  getRecentAiReplies,
  hasAiReplyAfterInbound,
  hasManualReplyAfterInbound,
  refreshConversationMemory,
  resolveLeadTagsForAi
} from "./replyContext.js";
import type { OfficialLink } from "../../types/ai.js";

async function resolveClientNameForAi(chatId: string): Promise<string | null> {
  try {
    if (!prisma) return null;
    const phone = phoneFromChatId(chatId);
    const contact = await findContactByPhoneLoose(phone);
    const name = contact?.name?.trim();
    if (!name || name.replace(/\D/g, "") === phone.replace(/\D/g, "")) return null;
    return name;
  } catch (err) {
    console.warn("[ai] resolveClientNameForAi failed", err);
    return null;
  }
}

function parseOfficialLinks(raw: unknown): OfficialLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const o = x as Record<string, unknown>;
      return {
        trigger: String(o.trigger ?? "").trim(),
        url: String(o.url ?? "").trim(),
        label: String(o.label ?? "").trim()
      };
    })
    .filter((l) => l.trigger && l.url);
}

export async function processReplyJob(payload: AiReplyJobPayload): Promise<void> {
  if (!prisma) return;

  const settingsRow = await prisma.instanceAiSettings.findUnique({
    where: { session: payload.session }
  });
  if (!settingsRow?.autoReplyEnabled) return;

  const inbound = await prisma.inboxMessage.findFirst({
    where: {
      session: payload.session,
      OR: [{ id: payload.inboundMessageId }, { waMessageId: payload.inboundMessageId }]
    }
  });
  if (!inbound || inbound.fromMe) return;

  const mode = await resolveChatModeForInbound(
    payload.session,
    payload.chatId,
    settingsRow.humanIdleSec,
    inbound.timestamp
  );
  if (mode === "human") {
    await logAiEvent({
      session: payload.session,
      chatId: payload.chatId,
      event: "cancelled_human",
      detail: "Modo humano ativo"
    });
    await clearPendingReply(payload.session, payload.chatId);
    return;
  }

  const state = await findChatState(payload.session, payload.chatId);
  if (state?.pendingInboundId && state.pendingInboundId !== payload.inboundMessageId) {
    return;
  }

  const inboundBatch = await collectInboundBatchForReply({
    session: payload.session,
    chatId: payload.chatId,
    anchorInboundId: payload.inboundMessageId
  });

  if (await hasAiReplyAfterInbound({
    session: payload.session,
    chatId: payload.chatId,
    inboundTimestamp: inboundBatch.anchorTimestamp
  })) {
    await clearPendingReply(payload.session, payload.chatId);
    return;
  }

  if (await hasManualReplyAfterInbound({
    session: payload.session,
    chatId: payload.chatId,
    inboundTimestamp: inboundBatch.anchorTimestamp
  })) {
    await logAiEvent({
      session: payload.session,
      chatId: payload.chatId,
      event: "cancelled_human",
      detail: "Atendente já respondeu manualmente"
    });
    await clearPendingReply(payload.session, payload.chatId);
    return;
  }

  const daily = await countDailyReplies(payload.session);
  if (daily >= settingsRow.maxDailyReplies) {
    await logAiEvent({
      session: payload.session,
      chatId: payload.chatId,
      event: "error",
      detail: "Limite diário de respostas atingido"
    });
    return;
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

  const officialLinks = parseOfficialLinks(settingsRow.officialLinks);
  const clientName = await resolveClientNameForAi(payload.chatId);
  const leadTags = await resolveLeadTagsForAi(payload.chatId);
  const systemPrompt =
    buildSystemPrompt({
      productContext: settingsRow.productContext,
      officialFacts: settingsRow.officialFacts,
      rulesAllowed: settingsRow.rulesAllowed,
      rulesForbidden: settingsRow.rulesForbidden,
      officialLinks,
      clientName,
      leadTags
    }) + `\n\nLinks disponíveis: ${injectOfficialLinksHint(officialLinks)}`;

  const chatHistory = await buildChatHistoryForAi(payload.session, payload.chatId, {
    apiKey,
    model: settingsRow.modelChat
  });
  const recentAiReplies = await getRecentAiReplies(payload.session, payload.chatId);

  let inboundText = inboundBatch.combinedText;
  if (!inboundText.trim()) {
    try {
      inboundText = await extractInboundTextForReply({
        message: inbound,
        settings: settingsRow,
        apiKey
      });
    } catch (err) {
      await logAiEvent({
        session: payload.session,
        chatId: payload.chatId,
        event: "error",
        detail: `mediaExtract: ${err instanceof Error ? err.message : String(err)}`
      });
      inboundText = inbound.body.trim() || "(mensagem sem texto)";
    }
  }

  const snippets = await fetchKnowledgeSnippetsForAi(payload.session, payload.chatId, {
    inboundText
  });
  const officialFacts = buildOfficialFactsBlock(settingsRow.officialFacts);

  let reply: string;
  try {
    reply = await generateReply({
      apiKey,
      model: settingsRow.modelChat,
      systemPrompt,
      chatHistory,
      officialFacts,
      knowledgeSnippets: snippets,
      inboundText,
      recentAiReplies
    });

    if (isRepetitiveReply(reply, recentAiReplies)) {
      reply = await generateReply({
        apiKey,
        model: settingsRow.modelChat,
        systemPrompt,
        chatHistory,
        officialFacts,
        knowledgeSnippets: snippets,
        inboundText,
        recentAiReplies,
        retryAvoidRepeat: true
      });
    }
  } catch (err) {
    await logAiEvent({
      session: payload.session,
      chatId: payload.chatId,
      event: "error",
      detail: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }

  const validation = validateReplyAgainstRules(reply, settingsRow.rulesForbidden);
  if (!validation.ok) {
    await logAiEvent({
      session: payload.session,
      chatId: payload.chatId,
      event: "blocked_rule",
      detail: validation.reason
    });
    await clearPendingReply(payload.session, payload.chatId);
    return;
  }

  if (await hasAiReplyAfterInbound({
    session: payload.session,
    chatId: payload.chatId,
    inboundTimestamp: inboundBatch.anchorTimestamp
  })) {
    await clearPendingReply(payload.session, payload.chatId);
    return;
  }

  const waMessageId = await sendText(phoneFromChatId(payload.chatId), reply);

  await saveInboxMessage({
    chatId: payload.chatId,
    body: reply,
    fromMe: true,
    source: "ai",
    type: "chat",
    waMessageId,
    sessionName: payload.session
  });

  await logAiEvent({
    session: payload.session,
    chatId: payload.chatId,
    event: "replied",
    detail: reply.slice(0, 200)
  });
  await clearPendingReply(payload.session, payload.chatId);

  void refreshConversationMemory({
    session: payload.session,
    chatId: payload.chatId,
    apiKey,
    model: settingsRow.modelChat
  }).catch((err) => console.warn("[ai] post-reply memory refresh failed", err));
}

export async function simulateReply(params: {
  session: string;
  chatId: string;
  inboundText: string;
}): Promise<{ reply: string; blocked?: string; knowledgeUsed?: number }> {
  const settings = await getAiSettings(params.session);
  const apiKey = await resolveOpenAiApiKey(params.session);
  if (!apiKey) throw new Error("Configure a chave OpenAI desta instância no painel");

  const systemPrompt = buildSystemPrompt({
    productContext: settings.productContext,
    officialFacts: settings.officialFacts,
    rulesAllowed: settings.rulesAllowed,
    rulesForbidden: settings.rulesForbidden,
    officialLinks: settings.officialLinks,
    clientName: await resolveClientNameForAi(params.chatId),
    leadTags: await resolveLeadTagsForAi(params.chatId)
  });

  const chatHistory = await buildChatHistoryForAi(params.session, params.chatId, {
    apiKey,
    model: settings.modelChat
  });
  const snippets = await fetchKnowledgeSnippetsForAi(params.session, params.chatId, {
    inboundText: params.inboundText
  });
  const officialFacts = buildOfficialFactsBlock(settings.officialFacts);

  const reply = await generateReply({
    apiKey,
    model: settings.modelChat,
    systemPrompt,
    chatHistory,
    officialFacts,
    knowledgeSnippets: snippets,
    inboundText: params.inboundText
  });

  const validation = validateReplyAgainstRules(reply, settings.rulesForbidden);
  if (!validation.ok) {
    return { reply, blocked: validation.reason, knowledgeUsed: snippets.length };
  }
  return { reply, knowledgeUsed: snippets.length };
}
