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
  CustomWebhookMapping,
  DelayNodeData,
  DelayUnit,
  FlowGraph,
  HotmartMapping,
  ScheduleAtNodeData,
  SendMediaNodeData,
  SendTextNodeData,
  SplitRoundRobinData,
  StartFlowData,
  TagActionData,
  TriggerCustomWebhookData,
  TriggerHotmartData,
  TriggerInboundData
} from "../types/flow.js";

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
  if (graph.nodes.some((n) => n.type === "trigger_hotmart_pending")) {
    return "trigger_hotmart_pending";
  }
  if (graph.nodes.some((n) => n.type === "trigger_hotmart")) return "trigger_hotmart";
  if (graph.nodes.some((n) => n.type === "trigger_custom_webhook")) return "trigger_custom_webhook";
  if (graph.nodes.some((n) => n.type === "trigger_broadcast")) return "trigger_broadcast";
  if (graph.nodes.some((n) => n.type === "trigger_tag")) return "trigger_tag";
  if (graph.nodes.some((n) => n.type === "trigger_inbound")) return "trigger_inbound";
  return "trigger_manual";
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

  const phone = assertValidWhatsAppPhone(
    String(vars.phone ?? ""),
    String(vars.countryIso ?? "BR")
  );

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
      const waMessageId = await wpp.sendText(phone, text);
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
    } catch (err) {
      await logSendFailure(node.type, err);
    }
    await logStep(flowRunId, nodeId, node.type, "ok", "Mensagem enviada");
  } else if (node.type === "send_image") {
    const data = node.data as unknown as SendMediaNodeData;
    const caption = data.caption ? render(data.caption, vars) : undefined;
    try {
      let waMessageId: string | null = null;
      await sendMediaWithRetries(async () => {
        waMessageId = await wpp.sendImage(phone, data.url, caption);
      });
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
    } catch (err) {
      await logSendFailure(node.type, err);
    }
    await logStep(flowRunId, nodeId, node.type, "ok", "Imagem enviada");
  } else if (node.type === "send_video") {
    const data = node.data as unknown as SendMediaNodeData;
    const caption = data.caption ? render(data.caption, vars) : undefined;
    try {
      let waMessageId: string | null = null;
      await sendMediaWithRetries(async () => {
        waMessageId = await wpp.sendVideo(phone, data.url, caption);
      });
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
    } catch (err) {
      await logSendFailure(node.type, err);
    }
    await logStep(flowRunId, nodeId, node.type, "ok", "Vídeo enviado");
  } else if (node.type === "send_audio") {
    const data = node.data as unknown as SendMediaNodeData;
    try {
      const waMessageId = await wpp.sendAudio(phone, data.url);
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
    } catch (err) {
      await logSendFailure(node.type, err);
    }
    await logStep(flowRunId, nodeId, node.type, "ok", "Áudio enviado");
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
  await prisma.flowRun.update({
    where: { id: flowRunId },
    data: { status, currentNodeId: null }
  });
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
        contactPhone: params.contactPhone,
        variables: params.variables as object,
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
    await executeNode(graph, run.id, firstActionId, params.variables);
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
 * Extrai name/phone/email de um payload genérico via JSONPath configurado no nó.
 * Se o mapeamento estiver vazio, tenta campos comuns de formulários Trajettu/captura
 * (fn/ln/phone/email, name/fullname, fields.*).
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

  const rawPhone =
    pickFirst(
      phonePath,
      "$.phone",
      "$.telefone",
      "$.tel",
      "$.celular",
      "$.whatsapp",
      "$.data.phone",
      "$.buyer.phone",
      "$.customer.phone",
      "$.fields.phone",
      "$.fields.telefone"
    ) || "";

  if (!rawPhone) {
    throw new Error(
      phonePath
        ? `Telefone não encontrado no path ${phonePath}`
        : "Telefone não encontrado (mapeie phonePath ou envie phone/telefone no JSON)."
    );
  }

  // Trajettu split: fn + ln → nome completo
  const fn = pickFirst("$.fn", "$.first_name", "$.firstname", "$.fields.fn");
  const ln = pickFirst("$.ln", "$.last_name", "$.lastname", "$.fields.ln");
  const composedFromParts = [fn, ln].filter(Boolean).join(" ").trim();

  const fullName =
    pickFirst(
      namePath,
      "$.fullname",
      "$.name",
      "$.nome",
      "$.full_name",
      "$.fullName",
      "$.buyer.name",
      "$.customer.name",
      "$.fields.fullname",
      "$.fields.name",
      "$.fields.nome"
    ) ||
    composedFromParts ||
    "Cliente";

  if (!namePath && !composedFromParts && fullName === "Cliente") {
    // Ainda sem nome mapeado e sem fn — avisa só se o usuário já tentou mapear
    if (mapping.namePath?.trim()) {
      throw new Error(`Nome não encontrado no path ${mapping.namePath}`);
    }
  }

  const name = firstNameFromFullName(fullName);
  const email = pickFirst(
    emailPath,
    "$.email",
    "$.mail",
    "$.e_mail",
    "$.buyer.email",
    "$.customer.email",
    "$.fields.email"
  );
  const externalId = pickFirst(
    externalIdPath,
    "$.event_id",
    "$.eventId",
    "$.id",
    "$.order_id",
    "$.transaction_id"
  );

  const normalizedPhone = assertValidWhatsAppPhone(rawPhone);

  return {
    phone: normalizedPhone,
    name,
    fullName,
    email,
    externalId,
    source: "custom_webhook"
  };
}
