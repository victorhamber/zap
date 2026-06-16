import { prisma } from "../../prisma.js";
import type { AiReplyJobPayload } from "../../types/ai.js";
import { saveInboxMessage } from "../inboxStore.js";
import { sendText } from "../whatsapp/index.js";
import { getAiSettings, resolveOpenAiApiKey } from "./settings.js";
import {
  buildSystemPrompt,
  validateReplyAgainstRules,
  injectOfficialLinksHint
} from "./rulesEngine.js";
import { generateReply } from "./openaiClient.js";
import {
  clearPendingReply,
  countDailyReplies,
  getChatState,
  logAiEvent,
  resolveChatModeForInbound
} from "./chatState.js";
import { extractInboundTextForReply } from "./mediaExtract.js";
import { phoneFromChatId } from "./tagGate.js";
import { findContactByPhoneLoose } from "../contacts.js";
import type { OfficialLink } from "../../types/ai.js";

async function resolveClientNameForAi(chatId: string): Promise<string | null> {
  if (!prisma) return null;
  const phone = phoneFromChatId(chatId);
  const contact = await findContactByPhoneLoose(phone);
  const name = contact?.name?.trim();
  if (!name || name.replace(/\D/g, "") === phone.replace(/\D/g, "")) return null;
  return name;
}

async function hasAiReplyAfterInbound(params: {
  session: string;
  chatId: string;
  inboundTimestamp: Date;
}): Promise<boolean> {
  if (!prisma) return false;
  const existing = await prisma.inboxMessage.findFirst({
    where: {
      session: params.session,
      chatId: params.chatId,
      fromMe: true,
      source: "ai",
      timestamp: { gte: params.inboundTimestamp }
    },
    select: { id: true }
  });
  return Boolean(existing);
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
  if (!settingsRow?.enabled || !settingsRow.autoReplyEnabled) return;

  const mode = await resolveChatModeForInbound(
    payload.session,
    payload.chatId,
    settingsRow.humanIdleSec
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

  const state = await getChatState(payload.session, payload.chatId);
  if (state?.pendingInboundId && state.pendingInboundId !== payload.inboundMessageId) {
    return;
  }

  const inbound = await prisma.inboxMessage.findFirst({
    where: {
      session: payload.session,
      OR: [{ id: payload.inboundMessageId }, { waMessageId: payload.inboundMessageId }]
    }
  });
  if (!inbound || inbound.fromMe) return;

  if (await hasAiReplyAfterInbound({
    session: payload.session,
    chatId: payload.chatId,
    inboundTimestamp: inbound.timestamp
  })) {
    await clearPendingReply(payload.session, payload.chatId);
    return;
  }

  const recentManual = await prisma.inboxMessage.findFirst({
    where: {
      session: payload.session,
      chatId: payload.chatId,
      fromMe: true,
      source: "manual",
      timestamp: { gte: new Date(Date.now() - settingsRow.replyDelaySec * 1000 - 5000) }
    }
  });
  if (recentManual) {
    await logAiEvent({
      session: payload.session,
      chatId: payload.chatId,
      event: "cancelled_human",
      detail: "Resposta manual recente"
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
  const systemPrompt =
    buildSystemPrompt({
      productContext: settingsRow.productContext,
      rulesAllowed: settingsRow.rulesAllowed,
      rulesForbidden: settingsRow.rulesForbidden,
      officialLinks,
      clientName
    }) + `\n\nLinks disponíveis: ${injectOfficialLinksHint(officialLinks)}`;

  const historyRows = await prisma.inboxMessage.findMany({
    where: { session: payload.session, chatId: payload.chatId },
    orderBy: { timestamp: "desc" },
    take: 12
  });
  historyRows.reverse();
  const chatHistory = historyRows
    .map((r) => `${r.fromMe ? "Atendente" : "Cliente"}: ${r.body}`)
    .join("\n");

  const knowledge = await prisma.instanceAiKnowledge.findMany({
    where: { session: payload.session, chatId: payload.chatId },
    orderBy: { createdAt: "desc" },
    take: 8
  });
  const snippets = knowledge.map((k) => `[${k.kind}] ${k.topic ?? ""}: ${k.content}`);

  const inboundText = await extractInboundTextForReply({
    message: inbound,
    settings: settingsRow,
    apiKey
  });

  const reply = await generateReply({
    apiKey,
    model: settingsRow.modelChat,
    systemPrompt,
    chatHistory,
    knowledgeSnippets: snippets,
    inboundText
  });

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
    inboundTimestamp: inbound.timestamp
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
}

export async function simulateReply(params: {
  session: string;
  chatId: string;
  inboundText: string;
}): Promise<{ reply: string; blocked?: string }> {
  const settings = await getAiSettings(params.session);
  if (!settings.enabled) throw new Error("Assistente desativado");

  const apiKey = await resolveOpenAiApiKey(params.session);
  if (!apiKey) throw new Error("Configure a chave OpenAI desta instância no painel");

  const systemPrompt = buildSystemPrompt({
    productContext: settings.productContext,
    rulesAllowed: settings.rulesAllowed,
    rulesForbidden: settings.rulesForbidden,
    officialLinks: settings.officialLinks,
    clientName: await resolveClientNameForAi(params.chatId)
  });

  const knowledge = prisma
    ? await prisma.instanceAiKnowledge.findMany({
        where: { session: params.session, chatId: params.chatId },
        orderBy: { createdAt: "desc" },
        take: 8
      })
    : [];

  const reply = await generateReply({
    apiKey,
    model: settings.modelChat,
    systemPrompt,
    chatHistory: "",
    knowledgeSnippets: knowledge.map((k) => `[${k.kind}] ${k.topic ?? ""}: ${k.content}`),
    inboundText: params.inboundText
  });

  const validation = validateReplyAgainstRules(reply, settings.rulesForbidden);
  if (!validation.ok) {
    return { reply, blocked: validation.reason };
  }
  return { reply };
}
