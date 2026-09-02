import Mustache from "mustache";
import { prisma } from "../prisma.js";
import { enqueueFlowJob } from "../queue.js";
import { queueFlowRunStart } from "../services/flowDispatch.js";
import { getByPath, asString } from "../utils/jsonPathLite.js";
import { resolveHotmartCountryIso, resolveHotmartPhone } from "../utils/hotmartPhone.js";
import { assertValidWhatsAppPhone, firstNameFromFullName } from "../utils/phone.js";
import { hotmartEventName, hotmartPurchaseStatus } from "../utils/hotmartEvents.js";
import {
  addContactTagsByNames,
  ensureContact,
  getContactTagNames,
  removeContactTagsByNames
} from "../services/contacts.js";
import * as wpp from "../services/whatsapp/index.js";
import { saveInboxMessage, contactHasInboundReply, canonicalizeChatId, resolveAllChatIdsForContact } from "../services/inboxStore.js";
import { toPublicMediaUrl } from "../services/uploads.js";
import {
  findFlowTriggerNode,
  getNextNodeId,
  getNextNodeIdByHandle,
  getNode,
  parseGraph
} from "./graph.js";
import type {
  ConditionContactTagData,
  ConditionContactRepliedData,
  ConditionOfferCodeData,
  ConditionWeekdayData,
  CustomWebhookMapping,
  DelayNodeData,
  DelayUnit,
  FlowGraph,
  HotmartMapping,
  ScheduleAtNodeData,
  SendEmailNodeData,
  SendGroupsNodeData,
  SendMediaNodeData,
  SendTextNodeData,
  SplitRoundRobinData,
  StartFlowData,
  TagActionData,
  TriggerCustomWebhookData,
  TriggerHotmartData,
  TriggerInboundData,
  TriggerWaLinkData,
  WaitWeekdayData
} from "../types/flow.js";
import { humanGapMs, reserveStaggeredStartDelay } from "../services/flowStagger.js";
import { defaultWhatsAppSession, env } from "../env.js";
import { sendTransactionalEmail } from "../services/email/resend.js";
import {
  enrichFlowVariables,
  normalizeFlowEmail,
  persistContactFromFlowVariables
} from "../services/flowVariables.js";
import {
  getSaoPauloClock,
  msUntilNextWeekdayTime,
  normalizeTimeHm,
  WEEKDAY_LABELS_PT
} from "../utils/saoPauloTime.js";

function delayToMs(value: number, unit: DelayUnit): number {
  const v = Math.max(0, value);
  switch (unit) {
    case "minutes":
      return v * 60 * 1000;
    case "hours":
      return v * 60 * 60 * 1000;
    case "days":
      return v * 24 * 60 * 60 * 1000;
    default:
      return v * 24 * 60 * 60 * 1000;
  }
}

function render(template: string, vars: Record<string, unknown>): string {
  return Mustache.render(template, vars);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableSendError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  // sendText já faz 1+3 tentativas internamente — não reempilhar aqui.
  if (/desistiu após \d+ tentativas|número sem WhatsApp/i.test(message)) return false;
  return /sendMedia|HTTP 400|HTTP 429|HTTP 500|timeout|econnreset|fetch failed|network|busy|instável/i.test(
    message
  );
}

async function sendWithRetries<T>(send: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await send();
    } catch (err) {
      last = err;
      if (attempt >= 2 || !isRetriableSendError(err)) throw err;
      await sleepMs(4500 * (attempt + 1));
    }
  }
  throw last;
}

async function sendMediaWithRetries(send: () => Promise<unknown>): Promise<void> {
  await sendWithRetries(send);
}

/** Grava no inbox imediatamente — não depende só do webhook (evita sumir no próximo poll). */
async function persistFlowOutboundMessage(params: {
  phone: string;
  body: string;
  type: string;
  mediaUrl?: string | null;
  waMessageId?: string | null;
}): Promise<void> {
  const { defaultWhatsAppSession } = await import("../env.js");
  const session = defaultWhatsAppSession();
  const phoneJid = params.phone.includes("@")
    ? params.phone
    : `${params.phone.replace(/\D/g, "")}@s.whatsapp.net`;
  const peerJids = await resolveAllChatIdsForContact(session, phoneJid);
  const chatId = await canonicalizeChatId(session, phoneJid, [...peerJids, params.phone]);
  await saveInboxMessage({
    chatId,
    body: params.body,
    fromMe: true,
    source: "flow",
    type: params.type,
    mediaUrl: params.mediaUrl ?? null,
    waMessageId: params.waMessageId ?? null,
    sessionName: session,
    peerJids: [...new Set([chatId, params.phone, phoneJid, ...peerJids])]
  });
}

export function resolveFlowTriggerType(graph: FlowGraph): string {
  if (graph.nodes.some((n) => n.type === "trigger_manual")) return "trigger_manual";
  if (graph.nodes.some((n) => n.type === "trigger_groups")) return "trigger_groups";
  if (graph.nodes.some((n) => n.type === "trigger_hotmart_pending")) {
    return "trigger_hotmart_pending";
  }
  if (graph.nodes.some((n) => n.type === "trigger_hotmart")) return "trigger_hotmart";
  if (graph.nodes.some((n) => n.type === "trigger_custom_webhook")) return "trigger_custom_webhook";
  if (graph.nodes.some((n) => n.type === "trigger_wa_link")) return "trigger_wa_link";
  if (graph.nodes.some((n) => n.type === "trigger_broadcast")) return "trigger_broadcast";
  if (graph.nodes.some((n) => n.type === "trigger_tag")) return "trigger_tag";
  if (graph.nodes.some((n) => n.type === "trigger_inbound")) return "trigger_inbound";
  return "trigger_manual";
}

function resolveSendTarget(vars: Record<string, unknown>): { phone: string; isGroup: boolean } {
  const raw = String(vars.phone ?? "").trim();
  const isGroup =
    vars.isGroup === true || raw.includes("@g.us") || raw.includes("@newsletter");
  if (isGroup) {
    if (!raw) throw new Error("Grupo vazio no fluxo.");
    const jid = raw.includes("@") ? raw : `${raw.replace(/\D/g, "")}@g.us`;
    return { phone: jid, isGroup: true };
  }
  return {
    phone: assertValidWhatsAppPhone(raw, String(vars.countryIso ?? "BR")),
    isGroup: false
  };
}

function resolveHotmartOfferCode(payload: unknown, mapping: HotmartMapping): string {
  const paths = [
    mapping.offerCodePath,
    "$.data.purchase.offer.code",
    "$.data.offer.code",
    "$.purchase.offer.code"
  ];

  for (const path of paths) {
    if (!path) continue;
    const v = asString(getByPath(payload, path));
    if (v) return v;
  }
  return "";
}

function resolveHotmartPurchaseId(payload: unknown, mapping: HotmartMapping): string {
  const paths = [
    mapping.purchaseIdPath,
    "$.data.purchase.transaction",
    "$.data.purchase.order_id",
    "$.data.purchase.id",
    "$.data.purchase.code",
    "$.id"
  ];

  for (const path of paths) {
    if (!path) continue;
    const v = asString(getByPath(payload, path));
    if (v) return v;
  }
  return "";
}

export function extractHotmartVariables(
  payload: unknown,
  mapping: HotmartMapping
): Record<string, unknown> {
  const countryIso = resolveHotmartCountryIso(payload);
  const phone = resolveHotmartPhone(payload, mapping.phonePath);
  const fullName =
    asString(getByPath(payload, mapping.namePath)) ??
    asString(getByPath(payload, "$.data.buyer.name")) ??
    asString(getByPath(payload, "$.data.buyer.first_name")) ??
    "Cliente";
  const name = firstNameFromFullName(fullName);
  const purchaseId = resolveHotmartPurchaseId(payload, mapping);

  if (!phone) {
    throw new Error(
      "Telefone não encontrado no payload Hotmart (tente buyer.checkout_phone ou buyer.phone)"
    );
  }
  if (!purchaseId) {
    throw new Error(
      "ID da compra não encontrado no payload Hotmart (tente purchase.transaction)"
    );
  }

  const normalizedPhone = assertValidWhatsAppPhone(phone, countryIso);

  return {
    phone: normalizedPhone,
    countryIso,
    name,
    fullName,
    purchaseId,
    email:
      asString(mapping.emailPath ? getByPath(payload, mapping.emailPath) : undefined) ??
      asString(getByPath(payload, "$.data.buyer.email")) ??
      "",
    productName:
      asString(mapping.productNamePath ? getByPath(payload, mapping.productNamePath) : undefined) ??
      asString(getByPath(payload, "$.data.product.name")) ??
      "",
    offerCode: resolveHotmartOfferCode(payload, mapping),
    offerName:
      asString(getByPath(payload, "$.data.purchase.offer.name")) ??
      asString(getByPath(payload, "$.data.offer.name")) ??
      "",
    login: asString(mapping.loginPath ? getByPath(payload, mapping.loginPath) : undefined) ?? "",
    password:
      asString(mapping.passwordPath ? getByPath(payload, mapping.passwordPath) : undefined) ?? "",
    accessLink:
      asString(mapping.accessLinkPath ? getByPath(payload, mapping.accessLinkPath) : undefined) ??
      "",
    hotmartEvent: hotmartEventName(payload),
    purchaseStatus: hotmartPurchaseStatus(payload),
    paymentType:
      asString(getByPath(payload, "$.data.purchase.payment.type")) ??
      asString(getByPath(payload, "$.purchase.payment.type")) ??
      "",
    pixCode:
      asString(getByPath(payload, "$.data.purchase.payment.pix_code")) ??
      asString(getByPath(payload, "$.data.purchase.payment.pixCode")) ??
      "",
    pixQrCode:
      asString(getByPath(payload, "$.data.purchase.payment.pix_qrcode")) ??
      asString(getByPath(payload, "$.data.purchase.payment.pixQrcode")) ??
      ""
  };
}

async function logStep(
  flowRunId: string,
  nodeId: string,
  nodeType: string,
  status: string,
  message?: string,
  payload?: unknown
) {
  if (!prisma) return;
  await prisma.flowRunStep.create({
    data: {
      flowRunId,
      nodeId,
      nodeType,
      status,
      message,
      payload: payload as object | undefined
    }
  });
}

/**
 * Máximo de blocos executados numa mesma "rodada" (sem delay/agendamento no meio).
 * Protege contra fluxos com ciclo desenhados no editor: sem isso a recursão
 * abaixo dispararia envios em loop até estourar a pilha.
 */
const MAX_NODES_PER_RUN_SEGMENT = 200;

async function executeNode(
  graph: FlowGraph,
  flowRunId: string,
  nodeId: string,
  vars: Record<string, unknown>,
  visitedCount = 0
): Promise<void> {
  if (visitedCount >= MAX_NODES_PER_RUN_SEGMENT) {
    const message = `Fluxo excedeu ${MAX_NODES_PER_RUN_SEGMENT} blocos seguidos — provável ciclo no desenho. Execução interrompida.`;
    await logStep(flowRunId, nodeId, "error", "failed", message);
    throw new Error(message);
  }
  const depth = visitedCount + 1;

  const node = getNode(graph, nodeId);
  if (!node) throw new Error(`Nó não encontrado: ${nodeId}`);

  const { phone, isGroup } = resolveSendTarget(vars);

  if (node.type === "condition_weekday") {
    const data = node.data as unknown as ConditionWeekdayData;
    void data;
    const clock = getSaoPauloClock();
    const handle = String(clock.weekday);
    const label = WEEKDAY_LABELS_PT[clock.weekday] ?? handle;

    await logStep(flowRunId, nodeId, node.type, "ok", `Hoje é ${label}`, {
      weekday: clock.weekday,
      dayKey: clock.dayKey
    });

    const nextId = getNextNodeIdByHandle(graph, nodeId, handle);
    if (!nextId) {
      await finishRun(flowRunId, "completed");
      return;
    }
    if (prisma) {
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { currentNodeId: nextId, status: "running" }
      });
    }
    await executeNode(graph, flowRunId, nextId, vars, depth);
    return;
  }

  if (node.type === "condition_offer_code") {
    const data = node.data as unknown as ConditionOfferCodeData;
    const offerCode = String(vars.offerCode ?? "")
      .trim()
      .toLowerCase();
    let matchedHandle = "default";
    let matchedLabel = "Outros";

    for (const branch of data.branches ?? []) {
      const codes = (branch.codes ?? [])
        .map((code) => String(code).trim().toLowerCase())
        .filter(Boolean);
      if (codes.length > 0 && codes.includes(offerCode)) {
        matchedHandle = branch.id;
        matchedLabel = branch.label?.trim() || branch.id;
        break;
      }
    }

    await logStep(
      flowRunId,
      nodeId,
      node.type,
      "ok",
      offerCode
        ? `Código "${vars.offerCode}" → ${matchedLabel}`
        : `Sem código de oferta → ${matchedLabel}`,
      { offerCode: vars.offerCode ?? "", branch: matchedHandle }
    );

    const nextId = getNextNodeIdByHandle(graph, nodeId, matchedHandle);
    if (!nextId) {
      await finishRun(flowRunId, "completed");
      return;
    }

    if (prisma) {
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { currentNodeId: nextId, status: "running" }
      });
    }

    await executeNode(graph, flowRunId, nextId, vars, depth);
    return;
  }

  if (node.type === "split_round_robin") {
    const data = node.data as unknown as SplitRoundRobinData;
    const branchCount = Math.min(4, Math.max(2, Number(data.branchCount) || 2));
    const labels = Array.from({ length: branchCount }, (_, i) => {
      const custom = data.labels?.[i]?.trim();
      return custom || `Mensagem ${i + 1}`;
    });

    let flowId = "unknown";
    if (prisma) {
      const run = await prisma.flowRun.findUnique({
        where: { id: flowRunId },
        select: { flowId: true }
      });
      flowId = run?.flowId ?? flowId;
    }

    const { reserveRoundRobinBranch } = await import("../services/flowRoundRobin.js");
    const index = await reserveRoundRobinBranch(flowId, nodeId, branchCount);
    const handle = `branch_${index}`;
    const label = labels[index] ?? `Mensagem ${index + 1}`;

    await logStep(flowRunId, nodeId, node.type, "ok", `Round robin → ${label} (${index + 1}/${branchCount})`, {
      branch: handle,
      branchIndex: index,
      branchCount,
      label
    });

    const nextId = getNextNodeIdByHandle(graph, nodeId, handle);
    if (!nextId) {
      await finishRun(flowRunId, "completed");
      return;
    }

    if (prisma) {
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { currentNodeId: nextId, status: "running" }
      });
    }

    await executeNode(graph, flowRunId, nextId, vars, depth);
    return;
  }

  if (node.type === "condition_contact_tag") {
    const data = node.data as unknown as ConditionContactTagData;
    const required = (data.tagNames ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    const contactTags = (await getContactTagNames(phone)).map((t) => t.toLowerCase());

    let hasTag = false;
    if (required.length > 0) {
      if (data.matchMode === "all") {
        hasTag = required.every((t) => contactTags.includes(t));
      } else {
        hasTag = required.some((t) => contactTags.includes(t));
      }
    }

    const handle = hasTag ? "yes" : "no";
    const label = hasTag ? "Tem a tag" : "Não tem a tag";

    await logStep(
      flowRunId,
      nodeId,
      node.type,
      "ok",
      required.length
        ? `${label}: ${required.join(", ")} (contato: ${contactTags.join(", ") || "nenhuma"})`
        : "Nenhuma tag configurada → Não",
      { required, contactTags, branch: handle }
    );

    const nextId = getNextNodeIdByHandle(graph, nodeId, handle);
    if (!nextId) {
      await finishRun(flowRunId, "completed");
      return;
    }

    if (prisma) {
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { currentNodeId: nextId, status: "running" }
      });
    }

    await executeNode(graph, flowRunId, nextId, vars, depth);
    return;
  }

  if (node.type === "condition_contact_replied") {
    const data = node.data as unknown as ConditionContactRepliedData;
    let since: Date | undefined;

    if (data.sinceFlowStart !== false && prisma) {
      const run = await prisma.flowRun.findUnique({
        where: { id: flowRunId },
        select: { createdAt: true }
      });
      since = run?.createdAt;
    }

    const withinDays = Math.max(0, Number(data.withinDays ?? 0));
    if (withinDays > 0) {
      const windowStart = new Date(Date.now() - withinDays * 86_400_000);
      since = since ? new Date(Math.max(since.getTime(), windowStart.getTime())) : windowStart;
    }

    const replied = await contactHasInboundReply({ phone, since });
    const handle = replied ? "yes" : "no";
    const label = replied ? "Respondeu" : "Não respondeu";

    await logStep(
      flowRunId,
      nodeId,
      node.type,
      "ok",
      since
        ? `${label} (desde ${since.toISOString().slice(0, 16).replace("T", " ")})`
        : label,
      { replied, branch: handle, since: since?.toISOString() ?? null }
    );

    const nextId = getNextNodeIdByHandle(graph, nodeId, handle);
    if (!nextId) {
      await finishRun(flowRunId, "completed");
      return;
    }

    if (prisma) {
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { currentNodeId: nextId, status: "running" }
      });
    }

    await executeNode(graph, flowRunId, nextId, vars, depth);
    return;
  }

  if (node.type === "tag_action") {
    const data = node.data as unknown as TagActionData;
    const tagNames = (data.tagNames ?? []).map((name) => String(name).trim()).filter(Boolean);
    if (tagNames.length > 0) {
      if (data.mode === "remove") {
        await removeContactTagsByNames(phone, tagNames);
      } else {
        await addContactTagsByNames(phone, tagNames, String(vars.name ?? ""));
      }
    }
    const actionLabel = data.mode === "remove" ? "Removidas" : "Adicionadas";
    await logStep(
      flowRunId,
      nodeId,
      node.type,
      "ok",
      tagNames.length > 0 ? `${actionLabel}: ${tagNames.join(", ")}` : "Nenhuma tag configurada"
    );
  } else if (node.type === "start_flow") {
    const data = node.data as unknown as StartFlowData;
    const targetFlowId = String(data.targetFlowId ?? "").trim();
    if (!targetFlowId) {
      await logStep(flowRunId, nodeId, node.type, "skipped", "Nenhum fluxo destino selecionado");
    } else if (!prisma) {
      throw new Error("Banco indisponível");
    } else {
      const targetFlow = await prisma.flow.findUnique({ where: { id: targetFlowId } });
      if (!targetFlow) {
        await logStep(flowRunId, nodeId, node.type, "failed", "Fluxo destino não encontrado");
      } else if (!targetFlow.enabled) {
        await logStep(
          flowRunId,
          nodeId,
          node.type,
          "skipped",
          `Fluxo "${targetFlow.name}" está inativo`
        );
      } else {
        try {
          const targetGraph = parseGraph(targetFlow.graphJson);
          const subResult = await queueFlowRunStart({
            flowId: targetFlowId,
            triggerType: resolveFlowTriggerType(targetGraph),
            contactPhone: phone,
            variables: { ...vars, phone },
            externalId: `from_${flowRunId}_${nodeId}_${Date.now()}`
          });
          if (subResult && "queued" in subResult && subResult.queued) {
            await logStep(
              flowRunId,
              nodeId,
              node.type,
              "scheduled",
              `Subfluxo "${targetFlow.name}" na fila (~${Math.round(subResult.delayMs / 1000)}s)`
            );
          } else if (subResult && "skipped" in subResult && subResult.skipped) {
            await logStep(
              flowRunId,
              nodeId,
              node.type,
              "skipped",
              `Subfluxo não iniciado: ${subResult.reason ?? "desconhecido"}`
            );
          } else {
            await logStep(
              flowRunId,
              nodeId,
              node.type,
              "ok",
              `Iniciou fluxo "${targetFlow.name}"`
            );
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await logStep(flowRunId, nodeId, node.type, "failed", message);
        }
      }
    }
  } else if (node.type === "delay") {
    const data = node.data as unknown as DelayNodeData;
    const ms = delayToMs(data.value ?? 1, data.unit ?? "days");
    const nextId = getNextNodeId(graph, nodeId);
    if (!nextId) {
      await finishRun(flowRunId, "completed");
      return;
    }
    const runAt = new Date(Date.now() + ms);
    const jobId = `${flowRunId}_${nextId}_delay`;
    const job = await enqueueFlowJob({ flowRunId, nodeId: nextId }, ms, jobId);
    if (prisma) {
      await prisma.scheduledJob.create({
        data: {
          flowRunId,
          nodeId: nextId,
          bullJobId: job.id ?? jobId,
          runAt,
          status: "pending"
        }
      });
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { status: "waiting", currentNodeId: nodeId }
      });
    }
    await logStep(flowRunId, nodeId, node.type, "scheduled", `Aguardando ${data.value} ${data.unit}`);
    return;
  }

  if (node.type === "schedule_at") {
    const data = node.data as unknown as ScheduleAtNodeData;
    const target = new Date(data.datetime);
    const ms = Math.max(0, target.getTime() - Date.now());
    const nextId = getNextNodeId(graph, nodeId);
    if (!nextId) {
      await finishRun(flowRunId, "completed");
      return;
    }
    const jobId = `${flowRunId}_${nextId}_at`;
    const job = await enqueueFlowJob({ flowRunId, nodeId: nextId }, ms, jobId);
    if (prisma) {
      await prisma.scheduledJob.create({
        data: {
          flowRunId,
          nodeId: nextId,
          bullJobId: job.id ?? jobId,
          runAt: target,
          status: "pending"
        }
      });
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { status: "waiting", currentNodeId: nodeId }
      });
    }
    await logStep(flowRunId, nodeId, node.type, "scheduled", `Agendado para ${data.datetime}`);
    return;
  }

  if (node.type === "wait_weekday") {
    const data = node.data as unknown as WaitWeekdayData;
    const weekday = Math.max(0, Math.min(6, Math.floor(Number(data.weekday) || 1)));
    const time = normalizeTimeHm(data.time, "09:00");
    const ms = msUntilNextWeekdayTime(weekday, time);
    const nextId = getNextNodeId(graph, nodeId);
    if (!nextId) {
      await finishRun(flowRunId, "completed");
      return;
    }
    const runAt = new Date(Date.now() + ms);
    const jobId = `${flowRunId}_${nextId}_wd${weekday}`;
    const job = await enqueueFlowJob({ flowRunId, nodeId: nextId }, ms, jobId);
    if (prisma) {
      await prisma.scheduledJob.create({
        data: {
          flowRunId,
          nodeId: nextId,
          bullJobId: job.id ?? jobId,
          runAt,
          status: "pending"
        }
      });
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { status: "waiting", currentNodeId: nodeId }
      });
    }
    const label = WEEKDAY_LABELS_PT[weekday] ?? String(weekday);
    await logStep(
      flowRunId,
      nodeId,
      node.type,
      "scheduled",
      `Aguardando ${label} ${time} (Brasília) — ~${Math.round(ms / 60000)} min`
    );
    return;
  }

  const logSendFailure = async (nodeType: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    await logStep(flowRunId, nodeId, nodeType, "failed", message);
    throw err;
  };

  if (node.type === "send_text") {
    const data = node.data as unknown as SendTextNodeData;
    const text = render(data.text ?? "", vars);
    if (!text.trim()) {
      await logStep(flowRunId, nodeId, node.type, "failed", "Texto da mensagem vazio");
      throw new Error("Texto da mensagem vazio");
    }
    try {
      // Retries (1+3) e variantes BR ficam em wpp.sendText — sem empilhar retry aqui.
      const waMessageId = await wpp.sendText(phone, text, isGroup ? { isGroup: true } : undefined);
      if (!isGroup) {
        try {
          await persistFlowOutboundMessage({
            phone,
            body: text,
            type: "chat",
            waMessageId
          });
        } catch {
          /* webhook ou gravação paralela — envio já foi feito */
        }
      }
    } catch (err) {
      await logSendFailure(node.type, err);
    }
    await logStep(
      flowRunId,
      nodeId,
      node.type,
      "ok",
      isGroup ? `Mensagem enviada ao grupo ${String(vars.groupName ?? phone)}` : "Mensagem enviada"
    );
  } else if (node.type === "send_image") {
    const data = node.data as unknown as SendMediaNodeData;
    const caption = data.caption ? render(data.caption, vars) : undefined;
    try {
      let waMessageId: string | null = null;
      await sendMediaWithRetries(async () => {
        waMessageId = await wpp.sendImage(phone, data.url, caption, isGroup ? { isGroup: true } : undefined);
      });
      if (!isGroup) {
        try {
          await persistFlowOutboundMessage({
            phone,
            body: caption?.trim() || "📷 Imagem",
            type: "image",
            mediaUrl: toPublicMediaUrl(data.url) ?? data.url,
            waMessageId
          });
        } catch {
          /* gravação paralela com webhook */
        }
      }
    } catch (err) {
      await logSendFailure(node.type, err);
    }
    await logStep(flowRunId, nodeId, node.type, "ok", isGroup ? "Imagem enviada ao grupo" : "Imagem enviada");
  } else if (node.type === "send_video") {
    const data = node.data as unknown as SendMediaNodeData;
    const caption = data.caption ? render(data.caption, vars) : undefined;
    try {
      let waMessageId: string | null = null;
      await sendMediaWithRetries(async () => {
        waMessageId = await wpp.sendVideo(phone, data.url, caption, isGroup ? { isGroup: true } : undefined);
      });
      if (!isGroup) {
        try {
          await persistFlowOutboundMessage({
            phone,
            body: caption?.trim() || "🎬 Vídeo",
            type: "video",
            mediaUrl: toPublicMediaUrl(data.url) ?? data.url,
            waMessageId
          });
        } catch {
          /* gravação paralela com webhook */
        }
      }
    } catch (err) {
      await logSendFailure(node.type, err);
    }
    await logStep(flowRunId, nodeId, node.type, "ok", isGroup ? "Vídeo enviado ao grupo" : "Vídeo enviado");
  } else if (node.type === "send_audio") {
    const data = node.data as unknown as SendMediaNodeData;
    try {
      const waMessageId = await wpp.sendAudio(phone, data.url, isGroup ? { isGroup: true } : undefined);
      if (!isGroup) {
        try {
          await persistFlowOutboundMessage({
            phone,
            body: "🎤 Áudio",
            type: "audio",
            mediaUrl: toPublicMediaUrl(data.url) ?? data.url,
            waMessageId
          });
        } catch {
          /* gravação paralela com webhook */
        }
      }
    } catch (err) {
      await logSendFailure(node.type, err);
    }
    await logStep(flowRunId, nodeId, node.type, "ok", isGroup ? "Áudio enviado ao grupo" : "Áudio enviado");
  } else if (node.type === "send_groups") {
    const data = node.data as unknown as SendGroupsNodeData;
    const groupIds = (data.groupIds ?? [])
      .map((id) => String(id).trim())
      .filter(Boolean);
    if (groupIds.length === 0) {
      await logStep(flowRunId, nodeId, node.type, "failed", "Nenhum grupo selecionado");
      throw new Error("Nenhum grupo selecionado no bloco Enviar para grupos");
    }

    const progressNode = String(vars._groupsSendNodeId ?? "");
    let index =
      progressNode === nodeId && typeof vars._groupsSendIndex === "number"
        ? Math.max(0, Math.floor(Number(vars._groupsSendIndex)))
        : 0;
    if (index >= groupIds.length) index = 0;

    const groupId = groupIds[index];
    const label = data.groupLabels?.[groupId] || groupId.replace(/@.*/, "");
    const mediaType = data.mediaType ?? "text";

    try {
      // Cadência global da sessão + envio ao grupo atual.
      await reserveStaggeredStartDelay(defaultWhatsAppSession(), 2, 6);
      if (mediaType === "text") {
        const text = render(data.text ?? "", vars);
        if (!text.trim()) {
          await logStep(flowRunId, nodeId, node.type, "failed", "Texto da mensagem vazio");
          throw new Error("Texto da mensagem vazio");
        }
        await wpp.sendText(groupId, text, { isGroup: true });
      } else if (mediaType === "image") {
        const caption = data.caption ? render(data.caption, vars) : undefined;
        await sendMediaWithRetries(async () => {
          await wpp.sendImage(groupId, String(data.url ?? ""), caption, { isGroup: true });
        });
      } else if (mediaType === "video") {
        const caption = data.caption ? render(data.caption, vars) : undefined;
        await sendMediaWithRetries(async () => {
          await wpp.sendVideo(groupId, String(data.url ?? ""), caption, { isGroup: true });
        });
      } else if (mediaType === "audio") {
        await sendMediaWithRetries(async () => {
          await wpp.sendAudio(groupId, String(data.url ?? ""), { isGroup: true });
        });
      } else {
        throw new Error(`Tipo de mídia inválido: ${mediaType}`);
      }
    } catch (err) {
      await logSendFailure(node.type, err);
    }

    await logStep(
      flowRunId,
      nodeId,
      node.type,
      "ok",
      `Grupo ${index + 1}/${groupIds.length}: ${label}`,
      { groupId, index }
    );

    const nextIndex = index + 1;
    if (nextIndex < groupIds.length) {
      const minSec = Math.max(5, Math.min(600, Number(data.staggerMinSec ?? 20) || 20));
      const maxSec = Math.max(minSec, Math.min(900, Number(data.staggerMaxSec ?? 45) || 45));
      const delayMs = humanGapMs(minSec, maxSec);
      const nextVars = {
        ...vars,
        _groupsSendIndex: nextIndex,
        _groupsSendNodeId: nodeId
      };
      const jobId = `${flowRunId}_${nodeId}_g${nextIndex}`;
      const job = await enqueueFlowJob({ flowRunId, nodeId }, delayMs, jobId);
      if (prisma) {
        await prisma.scheduledJob.create({
          data: {
            flowRunId,
            nodeId,
            bullJobId: job.id ?? jobId,
            runAt: new Date(Date.now() + delayMs),
            status: "pending"
          }
        });
        await prisma.flowRun.update({
          where: { id: flowRunId },
          data: {
            status: "waiting",
            currentNodeId: nodeId,
            variables: nextVars as object
          }
        });
      }
      await logStep(
        flowRunId,
        nodeId,
        node.type,
        "scheduled",
        `Aguardando ~${Math.round(delayMs / 1000)}s antes do próximo grupo`
      );
      return;
    }

    // Limpa progresso interno antes de seguir.
    if (prisma) {
      const cleaned = { ...vars };
      delete cleaned._groupsSendIndex;
      delete cleaned._groupsSendNodeId;
      Object.assign(vars, cleaned);
      delete (vars as Record<string, unknown>)._groupsSendIndex;
      delete (vars as Record<string, unknown>)._groupsSendNodeId;
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { variables: vars as object }
      });
    }
  } else if (node.type === "send_email") {
    const data = node.data as unknown as SendEmailNodeData;
    const phoneKey = String(vars.phone ?? "").trim();
    if (phoneKey && !phoneKey.includes("@g.us")) {
      Object.assign(vars, await enrichFlowVariables(phoneKey, vars));
    }
    const to = render(data.to || "{{email}}", vars).trim();
    const subject = render(data.subject ?? "", vars).trim();
    const html = render(data.html ?? "", vars);
    if (!to || !to.includes("@")) {
      const hint =
        normalizeFlowEmail(vars.email)
          ? "Confira o campo Para do nó."
          : "Mapeie e-mail no gatilho (Hotmart/webhook) ou cadastre no contato do CRM.";
      const message = `Destinatário de e-mail inválido ou vazio — ${hint}`;
      await logStep(flowRunId, nodeId, node.type, "failed", message, {
        toTemplate: data.to || "{{email}}",
        emailVar: normalizeFlowEmail(vars.email) ? "(preenchido)" : "(vazio)"
      });
      throw new Error(message);
    }
    if (!subject) {
      await logStep(flowRunId, nodeId, node.type, "failed", "Assunto do e-mail vazio");
      throw new Error("Assunto do e-mail vazio");
    }
    if (!html.trim()) {
      await logStep(flowRunId, nodeId, node.type, "failed", "Corpo do e-mail vazio");
      throw new Error("Corpo do e-mail vazio");
    }

    const emailSlotReady = vars._emailSlotNodeId === nodeId && vars._emailSlotReady === true;
    if (!emailSlotReady) {
      const minSec = Math.max(5, Math.min(300, env.EMAIL_DISPATCH_MIN_SEC));
      const maxSec = Math.max(minSec, Math.min(600, env.EMAIL_DISPATCH_MAX_SEC));
      const delayMs = await reserveStaggeredStartDelay("email", minSec, maxSec);
      if (delayMs > 0) {
        const nextVars = { ...vars, _emailSlotReady: true, _emailSlotNodeId: nodeId };
        const jobId = `${flowRunId}_${nodeId}_email`;
        const job = await enqueueFlowJob({ flowRunId, nodeId }, delayMs, jobId);
        if (prisma) {
          await prisma.scheduledJob.create({
            data: {
              flowRunId,
              nodeId,
              bullJobId: job.id ?? jobId,
              runAt: new Date(Date.now() + delayMs),
              status: "pending"
            }
          });
          await prisma.flowRun.update({
            where: { id: flowRunId },
            data: {
              status: "waiting",
              currentNodeId: nodeId,
              variables: nextVars as object
            }
          });
        }
        await logStep(
          flowRunId,
          nodeId,
          node.type,
          "scheduled",
          `Fila de e-mail: aguardando ~${Math.round(delayMs / 1000)}s (anti-spam)`
        );
        return;
      }
    }

    try {
      const result = await sendTransactionalEmail({
        to,
        subject,
        html,
        replyTo: data.replyTo ? render(data.replyTo, vars).trim() : undefined
      });
      await logStep(flowRunId, nodeId, node.type, "ok", `E-mail enviado para ${to}`, {
        id: result.id
      });
    } catch (err) {
      await logSendFailure(node.type, err);
    }

    delete vars._emailSlotReady;
    delete vars._emailSlotNodeId;
    if (prisma) {
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { variables: vars as object }
      });
    }
  } else if (
    node.type.startsWith("trigger_")
  ) {
    await logStep(flowRunId, nodeId, node.type, "ok", "Gatilho");
  }

  const nextId = getNextNodeId(graph, nodeId);
  if (!nextId) {
    await finishRun(flowRunId, "completed");
    return;
  }

  if (prisma) {
    await prisma.flowRun.update({
      where: { id: flowRunId },
      data: { currentNodeId: nextId, status: "running" }
    });
  }

  await executeNode(graph, flowRunId, nextId, vars, depth);
}

async function finishRun(flowRunId: string, status: string) {
  if (!prisma) return;
  const run = await prisma.flowRun.findUnique({
    where: { id: flowRunId },
    include: { flow: true }
  });
  if (!run) return;

  await prisma.flowRun.update({
    where: { id: flowRunId },
    data: { status, currentNodeId: null }
  });

  // Ciclo semanal de grupos: ao terminar, reinicia se o fluxo continuar publicado.
  if (
    status === "completed" &&
    run.triggerType === "trigger_groups" &&
    run.flow.enabled
  ) {
    try {
      const {
        groupsFlowHasScheduleNodes,
        ensureGroupsFlowRunning
      } = await import("../services/groupsFlowTrigger.js");
      if (groupsFlowHasScheduleNodes(run.flow.graphJson)) {
        // Evita reinício no mesmo tick se ainda houver runs irmãos ativos.
        setTimeout(() => {
          void ensureGroupsFlowRunning(run.flowId, "auto_cycle").catch((err) =>
            console.warn(
              `[groups-trigger] reinício após ciclo falhou flow=${run.flowId}:`,
              err instanceof Error ? err.message : err
            )
          );
        }, 2_000);
      }
    } catch (err) {
      console.warn(
        "[groups-trigger] falha ao agendar reinício:",
        err instanceof Error ? err.message : err
      );
    }
  }
}

export async function continueFlowRun(flowRunId: string, startNodeId: string) {
  if (!prisma) throw new Error("DATABASE_URL obrigatório");
  const run = await prisma.flowRun.findUnique({
    where: { id: flowRunId },
    include: { flow: true }
  });
  if (!run) throw new Error("FlowRun não encontrado");
  if (run.status === "completed" || run.status === "failed") return;

  const claimed = await prisma.flowRun.updateMany({
    where: { id: flowRunId, status: "waiting" },
    data: { status: "running" }
  });
  if (claimed.count === 0) return;

  const graph = parseGraph(run.flow.graphJson);
  const vars = run.variables as Record<string, unknown>;

  try {
    await executeNode(graph, flowRunId, startNodeId, vars);
  } catch (err: any) {
    await prisma.flowRun.update({
      where: { id: flowRunId },
      data: { status: "failed", errorMessage: err?.message ?? String(err) }
    });
    await logStep(flowRunId, startNodeId, "error", "failed", err?.message);
    throw err;
  }
}

export async function startFlowRun(params: {
  flowId: string;
  triggerType: string;
  contactPhone: string;
  variables: Record<string, unknown>;
  externalId?: string;
  startFromNodeId?: string;
  /** Início pelo inbox ou teste: usa o gatilho do fluxo só como ponto de entrada, sem webhook. */
  manualStart?: boolean;
}) {
  if (!prisma) throw new Error("DATABASE_URL obrigatório");

  const flow = await prisma.flow.findUnique({ where: { id: params.flowId } });
  if (!flow) throw new Error("Fluxo não encontrado");
  if (!flow.enabled) return { skipped: true, reason: "disabled" };

  if (params.externalId) {
    const existing = await prisma.flowRun.findUnique({
      where: {
        flowId_externalId: { flowId: params.flowId, externalId: params.externalId }
      }
    });
    if (existing) return { skipped: true, reason: "duplicate", runId: existing.id };
  }

  const contactPhone = params.contactPhone.trim();
  if (!contactPhone.includes("@g.us")) {
    await ensureContact(
      contactPhone,
      String(params.variables.fullName ?? params.variables.name ?? ""),
      String(params.variables.email ?? "")
    ).catch(() => {});
    await persistContactFromFlowVariables(contactPhone, params.variables).catch(() => {});
  }
  const variables = contactPhone.includes("@g.us")
    ? params.variables
    : await enrichFlowVariables(contactPhone, params.variables);

  const graph = parseGraph(flow.graphJson);
  let startNodeId = params.startFromNodeId;
  let recordedTriggerType = params.triggerType;

  if (!startNodeId) {
    if (params.manualStart) {
      const trigger = findFlowTriggerNode(graph);
      if (!trigger) {
        throw new Error("Este fluxo não tem gatilho. Adicione um bloco de gatilho no editor.");
      }
      startNodeId = trigger.id;
      recordedTriggerType = trigger.type;
    } else {
      const trigger = graph.nodes.find((n) => n.type === params.triggerType);
      if (!trigger) throw new Error(`Gatilho ${params.triggerType} não encontrado no fluxo`);
      startNodeId = trigger.id;
    }
  }

  let run;
  try {
    run = await prisma.flowRun.create({
      data: {
        flowId: params.flowId,
        triggerType: recordedTriggerType,
        contactPhone: contactPhone,
        variables: variables as object,
        externalId: params.externalId,
        status: "running",
        currentNodeId: startNodeId
      }
    });
  } catch (err: unknown) {
    // webhook reentregue em paralelo: o findUnique acima passou nas duas chamadas
    // e a unique flowId_externalId barra a segunda. Não é falha, é duplicata.
    if ((err as { code?: string })?.code === "P2002" && params.externalId) {
      const existing = await prisma.flowRun.findUnique({
        where: {
          flowId_externalId: { flowId: params.flowId, externalId: params.externalId }
        }
      });
      return { skipped: true, reason: "duplicate", runId: existing?.id };
    }
    throw err;
  }

  const firstActionId = getNextNodeId(graph, startNodeId);
  if (!firstActionId) {
    await finishRun(run.id, "completed");
    return { runId: run.id };
  }

  try {
    const startLabel = params.manualStart ? "Início manual (gatilho ignorado)" : "Início";
    await logStep(run.id, startNodeId, recordedTriggerType, "ok", startLabel);
    await executeNode(graph, run.id, firstActionId, variables);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.flowRun.update({
      where: { id: run.id },
      data: { status: "failed", errorMessage: message }
    });
    throw err;
  }
  return { runId: run.id };
}

export function matchInboundFlows(
  graph: FlowGraph,
  messageText: string,
  contactTagNames: string[] = []
): boolean {
  const trigger = graph.nodes.find((n) => n.type === "trigger_inbound");
  if (!trigger) return false;
  const data = trigger.data as unknown as TriggerInboundData;

  const requiredTags = (data.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (requiredTags.length > 0) {
    const normalized = contactTagNames.map((t) => t.toLowerCase());
    const hasTag = requiredTags.some((t) => normalized.includes(t));
    if (!hasTag) return false;
  }

  if (!data.keyword?.trim()) return true;
  return messageText.toLowerCase().includes(data.keyword.toLowerCase());
}

/** Normaliza texto da mensagem do link wa.me para comparar com o inbound. */
export function normalizeWaLinkMessage(text: string): string {
  return text
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Gatilho "Link WhatsApp": a mensagem inbound precisa bater com a mensagem
 * configurada no nó (texto do ?text= do wa.me).
 */
export function matchWaLinkTrigger(
  graph: FlowGraph,
  messageText: string
): { matched: true; data: TriggerWaLinkData } | { matched: false } {
  const trigger = graph.nodes.find((n) => n.type === "trigger_wa_link");
  if (!trigger) return { matched: false };
  const data = trigger.data as unknown as TriggerWaLinkData;
  const expected = normalizeWaLinkMessage(String(data.message ?? ""));
  if (!expected) return { matched: false };

  const incoming = normalizeWaLinkMessage(messageText);
  if (!incoming) return { matched: false };

  // Igualdade exata (após normalizar) ou inbound começa com a mensagem do link.
  if (incoming === expected || incoming.startsWith(expected)) {
    return { matched: true, data };
  }
  return { matched: false };
}

export function buildWaMeLink(ownerDigits: string, message: string): string {
  const digits = ownerDigits.replace(/\D/g, "");
  if (!digits) return "";
  const text = message.trim();
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${q}`;
}

export function getHotmartTriggerFromGraph(graph: FlowGraph) {
  const pending = graph.nodes.find((n) => n.type === "trigger_hotmart_pending");
  if (pending) return { node: pending, triggerType: "trigger_hotmart_pending" as const };
  const purchase = graph.nodes.find((n) => n.type === "trigger_hotmart");
  if (purchase) return { node: purchase, triggerType: "trigger_hotmart" as const };
  return null;
}

export function getHotmartMappingFromGraph(graph: FlowGraph): HotmartMapping {
  const trigger = getHotmartTriggerFromGraph(graph);
  if (!trigger) throw new Error("Gatilho Hotmart não configurado no fluxo");
  return (trigger.node.data as unknown as TriggerHotmartData).mapping;
}

export function getCustomWebhookTriggerFromGraph(graph: FlowGraph) {
  const node = graph.nodes.find((n) => n.type === "trigger_custom_webhook");
  if (!node) return null;
  return { node, triggerType: "trigger_custom_webhook" as const };
}

export function getCustomWebhookConfigFromGraph(graph: FlowGraph): TriggerCustomWebhookData {
  const trigger = getCustomWebhookTriggerFromGraph(graph);
  if (!trigger) throw new Error("Gatilho Webhook personalizado não configurado no fluxo");
  const data = trigger.node.data as unknown as TriggerCustomWebhookData;
  return {
    mapping: data.mapping ?? {
      phonePath: "",
      namePath: "",
      emailPath: ""
    },
    secret: typeof data.secret === "string" ? data.secret : undefined
  };
}

/**
 * Extrai name/phone/email de QUALQUER payload JSON via mapeamento (JSONPath).
 * Sem acoplamento a plataforma: o match é só o que o usuário configurou no nó.
 * Se um path estiver vazio, tenta chaves genéricas comuns (phone, email, name…)
 * só para facilitar o primeiro teste — o mapeamento explícito sempre tem prioridade.
 */
export function extractCustomWebhookVariables(
  payload: unknown,
  mapping: CustomWebhookMapping
): Record<string, unknown> {
  const phonePath = mapping.phonePath?.trim() || "";
  const namePath = mapping.namePath?.trim() || "";
  const emailPath = mapping.emailPath?.trim() || "";
  const externalIdPath = mapping.externalIdPath?.trim() || "";

  const pickFirst = (...paths: string[]): string => {
    for (const p of paths) {
      if (!p) continue;
      const v = asString(getByPath(payload, p));
      if (v?.trim()) return v.trim();
    }
    return "";
  };

  // Path mapeado é contrato: se definido, só ele. Senão, chaves genéricas.
  const rawPhone = phonePath
    ? pickFirst(phonePath)
    : pickFirst(
        "$.phone",
        "$.telefone",
        "$.tel",
        "$.celular",
        "$.whatsapp",
        "$.mobile",
        "$.data.phone",
        "$.buyer.phone",
        "$.customer.phone",
        "$.contact.phone",
        "$.fields.phone",
        "$.fields.telefone"
      );

  if (!rawPhone) {
    throw new Error(
      phonePath
        ? `Telefone não encontrado no path ${phonePath}`
        : "Telefone não encontrado. Mapeie o campo telefone no gatilho (ou envie phone no JSON)."
    );
  }

  let fullName = "";
  if (namePath) {
    fullName = pickFirst(namePath);
  } else {
    const fn = pickFirst(
      "$.fn",
      "$.first_name",
      "$.firstname",
      "$.firstName",
      "$.fields.fn",
      "$.fields.first_name"
    );
    const ln = pickFirst(
      "$.ln",
      "$.last_name",
      "$.lastname",
      "$.lastName",
      "$.fields.ln",
      "$.fields.last_name"
    );
    const composed = [fn, ln].filter(Boolean).join(" ").trim();
    fullName =
      pickFirst(
        "$.fullname",
        "$.name",
        "$.nome",
        "$.full_name",
        "$.fullName",
        "$.buyer.name",
        "$.customer.name",
        "$.contact.name",
        "$.fields.fullname",
        "$.fields.name",
        "$.fields.nome"
      ) || composed;
  }

  if (!fullName.trim()) {
    if (namePath) {
      throw new Error(`Nome não encontrado no path ${namePath}`);
    }
    fullName = "Cliente";
  }

  const name = firstNameFromFullName(fullName);
  const email = emailPath
    ? pickFirst(emailPath)
    : pickFirst(
        "$.email",
        "$.mail",
        "$.e_mail",
        "$.buyer.email",
        "$.customer.email",
        "$.contact.email",
        "$.fields.email"
      );
  const externalId = externalIdPath
    ? pickFirst(externalIdPath)
    : pickFirst(
        "$.event_id",
        "$.eventId",
        "$.id",
        "$.order_id",
        "$.orderId",
        "$.transaction_id",
        "$.transactionId"
      );

  const normalizedPhone = assertValidWhatsAppPhone(rawPhone);

  return {
    phone: normalizedPhone,
    name,
    fullName: fullName.trim(),
    email,
    externalId,
    source: "custom_webhook"
  };
}
